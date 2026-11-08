import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { routes } from '../app.routes';
import { MemberAuthService } from '../member-auth.service';
import { memberAuthGuard } from '../member-auth.guard';
import { memberRoleGuard } from '../member-role.guard';
import { MemberRoleManagementPageComponent } from './member-role-management-page.component';

describe('MemberRoleManagementPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRoleManagementPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MemberAuthService, useValue: { member: signal({ memberId: 'admin-1', role: 'admin' }) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads members, searches, and saves a selected role', () => {
    const fixture = TestBed.createComponent(MemberRoleManagementPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/members') && request.method === 'GET')
      .flush([
        { memberId: 'admin-1', name: 'Current Admin', role: 'admin', clubName: 'Club' },
        { memberId: 'member-2', name: 'Taylor Member', role: 'member', clubName: 'Club' },
      ]);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'Taylor';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);

    const select = fixture.nativeElement.querySelector('tbody select') as HTMLSelectElement;
    select.value = 'balance-staff';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('tbody button') as HTMLButtonElement).click();
    const update = http.expectOne((request) => request.url.endsWith('/members/member-2/role') && request.method === 'PATCH');
    expect(update.request.body).toEqual({ role: 'balance-staff' });
    update.flush({ memberId: 'member-2', role: 'balance-staff' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Role updated for Taylor Member.');
  });

  it('keeps the signed-in admin role protected', () => {
    const fixture = TestBed.createComponent(MemberRoleManagementPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/members')).flush([
      { memberId: 'admin-1', name: 'Current Admin', role: 'admin', clubName: 'Club' },
    ]);
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('tbody select') as HTMLSelectElement).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('tbody button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('restricts the route to administrators', () => {
    const route = routes.find((entry) => entry.path === 'member-role-management')!;
    expect(route.canActivate).toContain(memberAuthGuard);
    expect(route.canActivate).toContain(memberRoleGuard);
    expect(route.data?.['allowedRoles']).toEqual(['admin']);
  });
});