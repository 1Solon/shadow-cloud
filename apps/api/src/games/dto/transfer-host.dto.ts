import { IsString, MaxLength } from 'class-validator';

export class TransferHostDto {
  @IsString()
  @MaxLength(100)
  targetPlayerEntryId!: string;
}