import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { Room } from 'src/schemas/rooms.schema';

interface JoinRoomPayload {
  id: string;
  password: string;
  userName: string;
  displayName: string;
}

interface PlaceBetPayload {
  roomId: string;
  playerName: string;
  betIndex: number;
  betAmount: number;
}

interface LeaveRoomPayload {
  id: string;
  playerName: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class RoomsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('RoomsGateway');
  private clients: Map<string, { roomId: string; playerName: string }> =
    new Map();
  private roomTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private readonly roomsService: RoomsService) {}

  afterInit() {
    this.logger.log('Rooms Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const clientData = this.clients.get(client.id);
    if (clientData) {
      const { roomId, playerName } = clientData;
      const updatedRoom = await this.roomsService.removePlayer(
        roomId,
        playerName,
      );

      this.server.to(roomId).emit('userLeft', {
        playerName,
        message: `${playerName} đã rời phòng`,
        playerCount: updatedRoom?.players.length || 0,
      });

      if (updatedRoom?.players.length === 0) {
        this.stopRoomTimer(roomId);
      }

      this.clients.delete(client.id);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody()
    data: JoinRoomPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const { id, password, userName, displayName } = data;
    if (!id || !password || !userName) {
      return { status: 'error', message: 'Thiếu thông tin' };
    }

    try {
      // Verify password first
      await this.roomsService.findByIdAndPassword(id, password);

      // 1. Lấy tiền trước
      const userMoney = await this.roomsService.getUserMoney(userName);

      // 2. Thêm player vào room kèm theo số tiền
      const updatedRoom = await this.roomsService.addPlayer(id, {
        userName,
        displayName,
        socketId: client.id,
        money: userMoney,
      });

      if (updatedRoom) {
        this.clients.set(client.id, { roomId: id, playerName: userName });
        client.join(id);

        // Start timer if it's not already running
        if (!this.roomTimers.has(id)) {
          this.startRoomTimer(id);
        }

        // Notify room
        this.server.to(id).emit('userJoined', {
          userName,
          displayName,
          message: `${displayName} đã vào phòng`,
          playerCount: updatedRoom.players.length,
        });

        // Cập nhật số người cho mọi người
        this.broadcastPlayerCount(id);

        return {
          status: 'success',
          message: 'Đã vào phòng',
          playerCount: updatedRoom.players.length,
          countdown: updatedRoom.countdown,
          phase: updatedRoom.phase,
          money: userMoney,
        };
      }
    } catch (error) {
      return {
        status: 'error',
        message:
          (error as Error).message || 'Mật khẩu sai hoặc phòng không tồn tại',
      };
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @MessageBody() data: LeaveRoomPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const { id, playerName } = data;
    this.clients.delete(client.id); // Xóa khỏi danh sách quản lý client
    const updatedRoom = await this.roomsService.removePlayer(id, playerName);
    client.leave(id);

    this.server.to(id).emit('userLeft', {
      playerName,
      message: `${playerName} đã rời phòng`,
      playerCount: updatedRoom?.players.length || 0,
    });

    if (updatedRoom?.players.length === 0) {
      this.stopRoomTimer(id);
    }
  }

  @SubscribeMessage('placeBet')
  async handlePlaceBet(
    @MessageBody()
    data: PlaceBetPayload,
  ) {
    const { roomId, playerName, betIndex, betAmount } = data;
    if (betIndex < 0 || betIndex > 5)
      return { status: 'error', message: 'Ô cược không hợp lệ' };

    if (!betAmount || betAmount <= 0)
      return { status: 'error', message: 'Số tiền cược không hợp lệ' };

    const room = await this.roomsService.findOne(roomId);
    if (!room || room.phase !== 'betting') {
      return {
        status: 'error',
        message: 'Chỉ được đặt cược trong phase betting',
      };
    }

    const result = await this.roomsService.placeBet(
      roomId,
      playerName,
      betIndex,
      betAmount,
    );

    if (!result) {
      return { status: 'error', message: 'Không đủ tiền hoặc lỗi hệ thống' };
    }

    const { room: updatedRoom, money } = result;

    // Thông báo cập nhật cược cho mọi người
    this.server.to(roomId).emit('betsUpdate', {
      bets: updatedRoom?.bets || {},
    });

    const betsForPlayer = (updatedRoom?.bets as Record<string, number[]>) || {};
    return { status: 'success', bets: betsForPlayer[playerName], money };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody()
    data: {
      roomId: string;
      userName: string;
      displayName: string;
      message: string;
    },
  ) {
    const { roomId, userName, displayName, message } = data;
    if (!roomId || !message) return;

    // Emit to everyone in the room
    this.server.to(roomId).emit('newMessage', {
      userName,
      displayName,
      message,
    });
  }

  private startRoomTimer(roomId: string) {
    if (this.roomTimers.has(roomId)) return;

    this.logger.log(`Starting game loop for room ${roomId}`);

    const interval = setInterval(() => {
      (async () => {
        const room = await this.roomsService.findOne(roomId);
        if (!room || room.players.length === 0) {
          this.stopRoomTimer(roomId);
          return;
        }

        let { countdown, phase } = room;
        countdown--;

        if (countdown < 0) {
          let updateData: Partial<Room> = {};
          if (phase === 'betting') {
            phase = 'result';
            countdown = 15;
            // Random 3 số từ 0-5
            const result = [
              Math.floor(Math.random() * 6),
              Math.floor(Math.random() * 6),
              Math.floor(Math.random() * 6),
            ];
            updateData = { countdown, phase, result };

            // Xử lý trả thưởng
            const payouts = await this.roomsService.handlePayouts(
              roomId,
              result,
            );
            this.server.to(roomId).emit('gameResult', { result, payouts });
          } else {
            phase = 'betting';
            countdown = 30;
            // Reset bets khi sang ván mới
            updateData = { countdown, phase, bets: {}, result: [] };
          }
          await this.roomsService.updateRoom(roomId, updateData);
        } else {
          await this.roomsService.updateRoom(roomId, { countdown });
        }

        this.server.to(roomId).emit('roomUpdate', {
          countdown: countdown,
          phase,
        });
      })().catch((err) => {
        this.logger.error(`Error in room timer ${roomId}: ${err.message}`);
      });
    }, 1000);

    this.roomTimers.set(roomId, interval);
  }

  private stopRoomTimer(roomId: string) {
    const interval = this.roomTimers.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.roomTimers.delete(roomId);
      this.logger.log(`Stopped game loop for room ${roomId}`);
    }
  }

  private broadcastPlayerCount(roomId: string) {
    this.roomsService.findOne(roomId).then((room) => {
      if (room) {
        this.server.to(roomId).emit('playerCountUpdate', {
          count: room.players.length,
        });
      }
    });
  }
}
