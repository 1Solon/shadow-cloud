import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

export class ReorderSeatOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seatEntryIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clearedSeatEntryIds?: string[];

  @IsOptional()
  @IsString()
  activePlayerEntryId?: string;
}
