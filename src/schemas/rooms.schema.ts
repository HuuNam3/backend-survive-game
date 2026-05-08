import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

@Schema({
  collection: 'rooms',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
})
export class Room {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: 'betting' })
  phase: string;

  @Prop({ default: 30 })
  countdown: number;

  @Prop({ default: 4 })
  maxPlayers: number;

  @Prop({ type: [Object], default: [] })
  players: any[];

  @Prop({ type: Object, default: {} })
  bets: Record<string, any>;

  @Prop({ type: [Object], default: [] })
  result: any[];
}

export const RoomSchema = SchemaFactory.createForClass(Room);
