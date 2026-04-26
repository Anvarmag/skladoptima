import { Controller, Get, Post, Delete, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { TeamService } from './team.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { ActiveTenantId } from '../tenants/decorators/active-tenant-id.decorator';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@Controller('team')
export class TeamController {
    constructor(private readonly teamService: TeamService) {}

    // Accept не требует активного tenant — участник ещё не состоит в нём
    @Post('invitations/:token/accept')
    acceptInvitation(@Req() req: any, @Param('token') token: string) {
        return this.teamService.acceptInvitation(token, req.user.id);
    }

    @Get('invitations')
    @UseGuards(RequireActiveTenantGuard)
    listInvitations(@Req() req: any, @ActiveTenantId() tenantId: string) {
        return this.teamService.listInvitations(req.user.id, tenantId);
    }

    @Post('invitations')
    @UseGuards(RequireActiveTenantGuard, TenantWriteGuard)
    createInvitation(
        @Req() req: any,
        @ActiveTenantId() tenantId: string,
        @Body() dto: CreateInvitationDto,
    ) {
        return this.teamService.createInvitation(req.user.id, tenantId, dto);
    }

    @Post('invitations/:id/resend')
    @UseGuards(RequireActiveTenantGuard, TenantWriteGuard)
    resendInvitation(
        @Req() req: any,
        @ActiveTenantId() tenantId: string,
        @Param('id') id: string,
    ) {
        return this.teamService.resendInvitation(req.user.id, tenantId, id);
    }

    @Delete('invitations/:id')
    @UseGuards(RequireActiveTenantGuard, TenantWriteGuard)
    cancelInvitation(
        @Req() req: any,
        @ActiveTenantId() tenantId: string,
        @Param('id') id: string,
    ) {
        return this.teamService.cancelInvitation(req.user.id, tenantId, id);
    }

    @Get('members')
    @UseGuards(RequireActiveTenantGuard)
    listMembers(@Req() req: any, @ActiveTenantId() tenantId: string) {
        return this.teamService.listMembers(req.user.id, tenantId);
    }

    @Patch('members/:membershipId/role')
    @UseGuards(RequireActiveTenantGuard, TenantWriteGuard)
    changeRole(
        @Req() req: any,
        @ActiveTenantId() tenantId: string,
        @Param('membershipId') membershipId: string,
        @Body() dto: ChangeRoleDto,
    ) {
        return this.teamService.changeRole(req.user.id, tenantId, membershipId, dto);
    }

    @Delete('members/:membershipId')
    @UseGuards(RequireActiveTenantGuard, TenantWriteGuard)
    removeMember(
        @Req() req: any,
        @ActiveTenantId() tenantId: string,
        @Param('membershipId') membershipId: string,
    ) {
        return this.teamService.removeMember(req.user.id, tenantId, membershipId);
    }

    @Post('members/:membershipId/leave')
    @UseGuards(RequireActiveTenantGuard, TenantWriteGuard)
    leaveTeam(
        @Req() req: any,
        @ActiveTenantId() tenantId: string,
        @Param('membershipId') membershipId: string,
    ) {
        return this.teamService.leaveTeam(req.user.id, tenantId, membershipId);
    }
}
