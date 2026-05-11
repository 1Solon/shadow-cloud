import { IsIn, IsString } from 'class-validator';

export class AuthorizeHostCommandDto {
  @IsString()
  discordThreadId!: string;

  @IsString()
  callerDiscordId!: string;

  @IsIn(['pin', 'unpin'])
  commandName!: 'pin' | 'unpin';
}
