import { IsEmail, IsString } from 'class-validator';

export class SyncDiscordIdentityDto {
  @IsString()
  provider!: string;

  @IsString()
  providerId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  displayName!: string;
}
