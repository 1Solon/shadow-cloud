import { IsString } from 'class-validator';

export class UndoVictoryDto {
  @IsString()
  discordThreadId!: string;

  @IsString()
  callerDiscordId!: string;
}
