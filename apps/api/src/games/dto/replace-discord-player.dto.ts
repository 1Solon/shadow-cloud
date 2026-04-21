import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReplaceDiscordPlayerDto {
  @IsString()
  @MaxLength(100)
  discordThreadId!: string;

  @IsString()
  @MaxLength(100)
  callerDiscordId!: string;

  @IsInt()
  @Min(1)
  seatNumber!: number;

  @IsString()
  @MaxLength(100)
  newPlayerDiscordId!: string;

  @IsString()
  @MaxLength(100)
  newPlayerDisplayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  newPlayerUsername?: string;
}
