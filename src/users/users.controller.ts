import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { PaginatedResult } from '../common/dto/api-response';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { MAX_AVATAR_BYTES } from '../storage/storage.constants';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponse } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.usersService.create(dto);
  }

  @Get()
  async findAll(@Query() query: PaginationQueryDto): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<UserResponse> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.usersService.remove(id);
  }

  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
  async uploadAvatar(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UserResponse> {
    return this.usersService.updateAvatar(id, file);
  }
}
