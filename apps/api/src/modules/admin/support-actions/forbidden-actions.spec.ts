import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    FORBIDDEN_ADMIN_ROUTE_TOKENS,
    FORBIDDEN_SUPPORT_ACTIONS,
} from './forbidden-actions';

/// TASK_ADMIN_5: регрессионный invariant «admin-плоскость не объявляет
/// маршрутов под запрещённые support-действия». Проходим по controller-файлам
/// admin-модуля и убеждаемся, что в них нет ни Get/Post-декораторов, ни
/// @Controller-prefix'ов, содержащих токены из `FORBIDDEN_ADMIN_ROUTE_TOKENS`.
///
/// Это статическая проверка по исходникам — она ловит появление endpoint'ов
/// типа `POST /admin/users/:id/login-as` или `POST /admin/billing-override`
/// ещё до раунд-трипа через Nest reflector.
describe('forbidden support actions registry', () => {
    const ADMIN_ROOT = path.resolve(__dirname, '..');

    function listControllerFiles(root: string): string[] {
        const out: string[] = [];
        const stack = [root];
        while (stack.length) {
            const dir = stack.pop()!;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) stack.push(full);
                else if (entry.isFile() && entry.name.endsWith('.controller.ts')) out.push(full);
            }
        }
        return out;
    }

    const controllerFiles = listControllerFiles(ADMIN_ROOT);

    it('admin module объявляет хотя бы один controller (sanity)', () => {
        expect(controllerFiles.length).toBeGreaterThan(0);
    });

    it('реестр forbidden actions непуст и содержит ключевые категории', () => {
        expect(FORBIDDEN_ADMIN_ROUTE_TOKENS.length).toBeGreaterThan(0);
        expect(FORBIDDEN_SUPPORT_ACTIONS.LOGIN_AS_USER).toBeDefined();
        expect(FORBIDDEN_SUPPORT_ACTIONS.IMPERSONATE).toBeDefined();
        expect(FORBIDDEN_SUPPORT_ACTIONS.BILLING_OVERRIDE).toBeDefined();
        expect(FORBIDDEN_SUPPORT_ACTIONS.READ_PASSWORD_HASH).toBeDefined();
    });

    it.each(FORBIDDEN_ADMIN_ROUTE_TOKENS)(
        'ни один admin controller не объявляет маршрут с токеном %s',
        (token) => {
            const offenders: string[] = [];
            for (const file of controllerFiles) {
                const src = fs.readFileSync(file, 'utf8');
                // Ищем токен в декораторах @Get/@Post/@Put/@Patch/@Delete/@Controller
                // и в строковых литералах. Регистронезависимо, чтобы не пропустить
                // case-вариации.
                const re = new RegExp(
                    `@(?:Get|Post|Put|Patch|Delete|Controller)\\s*\\([^)]*['"\`][^'"\`]*${token}[^'"\`]*['"\`]`,
                    'i',
                );
                if (re.test(src)) offenders.push(path.basename(file));
            }
            expect(offenders).toEqual([]);
        },
    );
});
