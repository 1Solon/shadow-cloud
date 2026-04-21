import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveRegistrationRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  discordMessageId?: string;
}
