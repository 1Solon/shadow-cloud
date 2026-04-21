import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDiscordPlayerDto {
  @IsString()
  @MaxLength(100)
  discordThreadId!: string;

  @IsString()
  @MaxLength(100)
  playerDiscordId!: string;

  @IsString()
  @MaxLength(100)
  playerDisplayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  playerUsername?: string;
}
