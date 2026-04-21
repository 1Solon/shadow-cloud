import { IsString } from 'class-validator';

export class SkipDiscordPlayerDto {
  @IsString()
  discordThreadId!: string;

  @IsString()
  callerDiscordId!: string;
}
