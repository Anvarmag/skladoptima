import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional, IsIn, Matches } from 'class-validator';

const ALLOWED_COUNTRIES  = ['RU', 'BY', 'KZ', 'UZ', 'AM', 'GE'];
const ALLOWED_CURRENCIES = ['RUB', 'BYN', 'KZT', 'UZS', 'AMD', 'GEL', 'USD', 'EUR'];
const ALLOWED_TIMEZONES  = [
    'Europe/Moscow', 'Europe/Minsk', 'Europe/Kaliningrad',
    'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Krasnoyarsk',
    'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok',
    'Asia/Almaty', 'Asia/Tashkent', 'Asia/Yerevan', 'Asia/Tbilisi',
    'UTC',
];

export class CreateTenantDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    @MaxLength(255)
    name: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\d{10}(\d{2})?$/, { message: 'inn must be 10 or 12 digits' })
    inn: string;

    @IsString()
    @IsIn(['USN_6', 'USN_15', 'OSNO', 'NPD'], { message: 'taxSystem must be USN_6, USN_15, OSNO or NPD' })
    taxSystem: 'USN_6' | 'USN_15' | 'OSNO' | 'NPD';

    @IsString()
    @IsIn(ALLOWED_COUNTRIES, { message: `country must be one of: ${ALLOWED_COUNTRIES.join(', ')}` })
    country: string;

    @IsString()
    @IsIn(ALLOWED_CURRENCIES, { message: `currency must be one of: ${ALLOWED_CURRENCIES.join(', ')}` })
    currency: string;

    @IsString()
    @IsIn(ALLOWED_TIMEZONES, { message: `timezone must be a supported IANA timezone` })
    timezone: string;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    legalName?: string;
}
