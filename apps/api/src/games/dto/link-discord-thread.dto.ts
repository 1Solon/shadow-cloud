import { IsString, MaxLength } from 'class-validator';

export class LinkDiscordThreadDto {
  @IsString()
  @MaxLength(100)
  discordThreadId!: string;
}
