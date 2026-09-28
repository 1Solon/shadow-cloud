import { IsString } from 'class-validator';

export class RejectDiscordSaveDto {
  @IsString()
  fileVersionId!: string;

  @IsString()
  callerDiscordId!: string;
}
