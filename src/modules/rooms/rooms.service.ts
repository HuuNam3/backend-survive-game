import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room, RoomDocument } from 'src/schemas/rooms.schema';
import {
  UserAccounts,
  UserAccountsDocument,
} from 'src/schemas/user-accounts.schema';

export interface Player {
  userName: string;
  displayName: string;
  socketId: string;
  money: number;
}

export interface Payout {
  playerName: string;
  totalWin: number;
  currentMoney: number;
}

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name)
    private readonly roomModel: Model<RoomDocument>,
    @InjectModel(UserAccounts.name)
    private readonly userModel: Model<UserAccountsDocument>,
  ) {}

  /** Tạo phòng mới */
  async create(id: string, password: string): Promise<Room> {
    const newRoom = new this.roomModel({
      id,
      password,
      phase: 'betting',
      countdown: 30,
      maxPlayers: 4,
      players: [],
      bets: {},
      result: [],
    });
    return await newRoom.save();
  }

  /** Lấy phòng theo id (không kiểm tra password) */
  async findOne(id: string): Promise<Room | null> {
    return await this.roomModel.findOne({ id }).exec();
  }

  /** Lấy phòng theo id + password, trả lỗi nếu sai */
  async findByIdAndPassword(id: string, password: string): Promise<Room> {
    const room = await this.roomModel.findOne({ id }).exec();
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng với id "${id}"`);
    }
    if (room.password !== password) {
      throw new ForbiddenException('Sai mật khẩu');
    }
    return room;
  }

  async addPlayer(id: string, player: Player): Promise<Room | null> {
    // Trước hết xóa player cũ có cùng tên (nếu có) để tránh bị lặp khi refresh trang
    await this.roomModel.updateOne(
      { id },
      { $pull: { players: { userName: player.userName } } },
    );

    return await this.roomModel
      .findOneAndUpdate(
        { id },
        { $push: { players: player } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  async removePlayer(id: string, playerName: string): Promise<Room | null> {
    return await this.roomModel
      .findOneAndUpdate(
        { id },
        { $pull: { players: { userName: playerName } } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  async updateRoom(id: string, update: Partial<Room>): Promise<Room | null> {
    return await this.roomModel
      .findOneAndUpdate({ id }, { $set: update }, { returnDocument: 'after' })
      .exec();
  }

  async placeBet(
    id: string,
    playerName: string,
    betIndex: number,
    betAmount: number,
  ): Promise<{ room: Room; money: number } | null> {
    // 1. Kiểm tra user và tiền trước
    const user = await this.userModel.findOne({ username: playerName });
    if (!user || user.money < betAmount) return null;

    // 2. Trừ tiền user (Atomic)
    const updatedUser = await this.userModel.findOneAndUpdate(
      { username: playerName, money: { $gte: betAmount } },
      { $inc: { money: -betAmount } },
      { returnDocument: 'after' },
    );

    if (!updatedUser) return null;

    // 3. Cập nhật cược (Atomic dùng dot notation)
    await this.roomModel.updateOne(
      { id, [`bets.${playerName}`]: { $exists: false } },
      { $set: { [`bets.${playerName}`]: [0, 0, 0, 0, 0, 0] } },
    );

    // Increment đúng vị trí trong mảng theo số tiền gửi lên
    const updatedRoom = await this.roomModel.findOneAndUpdate(
      { id },
      { $inc: { [`bets.${playerName}.${betIndex}`]: betAmount } },
      { returnDocument: 'after' },
    );

    if (!updatedRoom) return null;

    return { room: updatedRoom, money: updatedUser.money };
  }

  async handlePayouts(roomId: string, result: number[]): Promise<Payout[]> {
    const room = await this.findOne(roomId);
    if (!room || !room.bets) return [];

    const payouts: Payout[] = [];

    for (const [playerName, userBets] of Object.entries(room.bets)) {
      let totalWin = 0;
      const bets = userBets as number[];

      for (let i = 0; i < 6; i++) {
        const betAmount = bets[i];
        if (betAmount > 0) {
          const count = result.filter((num) => num === i).length;
          if (count > 0) {
            totalWin += betAmount * (count + 1);
          }
        }
      }

      if (totalWin > 0) {
        const updatedUser = await this.userModel.findOneAndUpdate(
          { username: playerName },
          { $inc: { money: totalWin } },
          { returnDocument: 'after' },
        );
        if (updatedUser) {
          payouts.push({
            playerName,
            totalWin,
            currentMoney: updatedUser.money,
          });
        }
      } else {
        const user = await this.userModel.findOne({ username: playerName });
        payouts.push({
          playerName,
          totalWin: 0,
          currentMoney: user?.money || 0,
        });
      }
    }
    return payouts;
  }

  async getUserMoney(playerName: string): Promise<number> {
    const user = await this.userModel.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${playerName}$`, 'i') } },
        { name: { $regex: new RegExp(`^${playerName}$`, 'i') } },
      ],
    });
    return user ? user.money : 0;
  }
}
