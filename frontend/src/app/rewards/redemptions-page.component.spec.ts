import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RedemptionsPageComponent } from './redemptions-page.component';

describe('Reward redemption tracking', () => {
  const record = {
    transactionId: 'redemption:0000000000001:00000000-0000-4000-8000-000000000001',
    memberId: 'player', memberName: 'Player', memberEmail: 'player@example.com',
    itemName: 'Voucher', points: 0, tokens: 15, used: false, usedAt: '', usedByName: '',
    createdAt: '2026-10-30T16:00:00.000Z',
  };
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [RedemptionsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(RedemptionsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    return { fixture, http, component: fixture.componentInstance };
  }
  const listRequest = (http: HttpTestingController) => http.expectOne((request) => request.url === '/redemptions');

  it('defaults to today in Philippine time, follows empty pages, and sorts all results by date', async () => {
    const { fixture, http, component } = await setup();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const first = listRequest(http);
    expect(first.request.withCredentials).toBe(true);
    expect(first.request.params.get('from')).toBe(today);
    expect(first.request.params.get('to')).toBe(today);
    expect(first.request.params.get('status')).toBe('all');
    first.flush({ records: [record], continuationToken: 'next' });
    const second = listRequest(http);
    expect(second.request.params.get('continuation')).toBe('next');
    second.flush({ records: [], continuationToken: 'next2' });
    listRequest(http).flush({
      records: [{ ...record, memberId: 'other', createdAt: '2026-10-31T02:00:00.000Z', used: true }],
      continuationToken: null,
    });
    fixture.detectChanges();
    expect(component['records']().map((entry) => entry.memberId)).toEqual(['other', 'player']);
    expect(fixture.nativeElement.textContent).toContain('Unused');
    expect(fixture.nativeElement.textContent).toContain('Used');
    http.verify();
  });

  it('applies date and status filters and refreshes after marking an item used', async () => {
    const { fixture, http, component } = await setup();
    listRequest(http).flush({ records: [], continuationToken: null });
    component['from'] = '2026-10-30';
    component['to'] = '2026-10-31';
    component['status'] = 'unused';
    component['load']();
    const filtered = listRequest(http);
    expect(filtered.request.params.get('from')).toBe('2026-10-30');
    expect(filtered.request.params.get('to')).toBe('2026-10-31');
    expect(filtered.request.params.get('status')).toBe('unused');
    filtered.flush({ records: [record], continuationToken: null });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.history-entry button') as HTMLButtonElement).click();
    const mark = http.expectOne((request) => request.method === 'POST' && request.url.includes('/used'));
    expect(mark.request.withCredentials).toBe(true);
    expect(mark.request.url).toContain(encodeURIComponent(record.transactionId));
    mark.flush({ used: true });
    listRequest(http).flush({ records: [], continuationToken: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No redemptions found');
    expect(fixture.nativeElement.textContent).toContain('marked as used');
    http.verify();
  });

  it('reports invalid ranges and failed page or mark requests', async () => {
    const { http, component } = await setup();
    listRequest(http).flush({ records: [record], continuationToken: null });
    component['from'] = '2026-11-02';
    component['to'] = '2026-11-01';
    component['load']();
    expect(component['error']()).toContain('valid from and to date');
    component['markUsed'](record);
    http.expectOne((request) => request.method === 'POST').flush(
      { message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' },
    );
    expect(component['error']()).toBe('Storage unavailable');
    component['from'] = '2026-11-01';
    component['load']();
    listRequest(http).flush({ records: [], continuationToken: 'next' });
    listRequest(http).flush({ message: 'Page failed' }, { status: 502, statusText: 'Bad Gateway' });
    expect(component['error']()).toBe('Page failed');
    expect(component['loaded']()).toBe(false);
    http.verify();
  });
});
