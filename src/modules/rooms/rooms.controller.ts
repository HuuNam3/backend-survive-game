import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';
import { Roles } from 'src/decorator/roles.decorator';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(['user'])
  async createOrJoin(@Body() body: { id: string; password: string }) {
    const { id, password } = body;
    if (!id || !password) {
      throw new HttpException('Thiếu id hoặc password', HttpStatus.BAD_REQUEST);
    }

    const existingRoom = await this.roomsService.findOne(id as string);
    if (existingRoom) {
      if (existingRoom.password === password) {
        return existingRoom;
      } else {
        throw new HttpException('Sai mật khẩu', HttpStatus.FORBIDDEN);
      }
    }

    return this.roomsService.create(id as string, password as string);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(['user'])
  async getRoom(@Query('id') id: string, @Query('password') password: string) {
    if (!id || !password) {
      throw new HttpException('Thiếu id hoặc password', HttpStatus.BAD_REQUEST);
    }
    return this.roomsService.findByIdAndPassword(id, password);
  }
}
