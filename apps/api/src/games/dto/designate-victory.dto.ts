import { IsString } from 'class-validator';

export class DesignateVictoryDto {
  @IsString()
  discordThreadId!: string;

  @IsString()
  callerDiscordId!: string;

  @IsString()
  victorDiscordId!: string;
}
