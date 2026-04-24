import { IsString, MaxLength } from 'class-validator';

export class ResignDiscordPlayerDto {
  @IsString()
  @MaxLength(100)
  discordThreadId!: string;

  @IsString()
  @MaxLength(100)
  playerDiscordId!: string;
}
