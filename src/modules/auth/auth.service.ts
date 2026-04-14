import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UserAccountsService } from '../user-accounts/user-accounts.service';
import { CreateUserAccountsDto } from 'src/dto/create-user-accounts.dto';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private readonly TService: UserAccountsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  register(user: CreateUserAccountsDto) {
    return this.TService.create(user);
  }

  async login(user: any, res: Response) {
    const payload = { email: user.email as string, sub: user._id };

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_TOKEN_EXPIRE',
      ) as any,
    });

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>(
        'JWT_ACCESS_TOKEN_EXPIRE',
      ) as any,
    });

    await this.saveRefreshToken(refreshToken as string, user._id as string);

    res.cookie('token', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1 * 60 * 60 * 1000,
    });

    return {
      user,
      accessToken,
      refreshToken,
      message: 'Login successful',
    };
  }

  logout(res: Response) {
    res.cookie('token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 0,
      expires: new Date(0),
    });

    res.cookie('isLogin', '', {
      httpOnly: false,
      secure: true,
      sameSite: 'none',
      maxAge: 0,
      expires: new Date(0),
    });

    return {
      message: 'Logout successful',
    };
  }

  async saveRefreshToken(refresh_token: string, userId: string) {
    const user = await this.TService.findOne(userId);
    if (user) {
      user.refresh_token = await hash(refresh_token, 10);
    }
  }

  async verfiyRefreshToken(refreshToken: string) {
    const decoded = this.jwtService.decode(refreshToken);
    if (!decoded) {
      return false;
    }
    const user = await this.TService.findOne(decoded.sub as string);
    if (user) {
      return user;
    }
    return false;
  }

  async validateUser(identifier: string, password: string) {
    const user = await this.TService.findByEmailOrUsername(identifier);
    if (!user) {
      throw new HttpException(
        'Tài khoản hoặc mật khẩu sai',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      throw new HttpException(
        'Tài khoản hoặc mật khẩu sai!',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return user;
  }
}
