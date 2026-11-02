import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { routes } from '../app.routes';
import { MyRewardsPageComponent } from './my-rewards-page.component';
import { StoreAdminPageComponent } from './store-admin-page.component';

const wallet = { memberId: 'player', activeGold: true, points: 100, tokens: 20, convertedPoints: 20, tokensSpent: 0 };
const item = {
  itemId: 'item-1', name: 'Voucher', imageUrl: 'https://example.com/image.png',
  merchantEmail: 'shop@example.com', merchantCc: '', merchantBcc: '', tokenCost: 15, enabled: true, version: 'v1',
};
const emptyHistory = { records: [], continuationToken: null };
const pendingKey = 'spaqueue-rewards-request:player';

describe('My points and rewards', () => {
  beforeEach(() => sessionStorage.removeItem(pendingKey));
  afterEach(() => sessionStorage.removeItem(pendingKey));

  async function setup(activeGold = true) {
    await TestBed.configureTestingModule({
      imports: [MyRewardsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(MyRewardsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/my-rewards').flush({ ...wallet, activeGold });
    http.expectOne('/store').flush([item]);
    http.expectOne('/my-rewards/history?kind=award').flush(emptyHistory);
    fixture.detectChanges();
    return { fixture, http, component: fixture.componentInstance };
  }

  function flushRefresh(http: HttpTestingController, kind: string) {
    http.expectOne('/my-rewards').flush(wallet);
    http.expectOne('/store').flush([item]);
    http.expectOne(`/my-rewards/history?kind=${kind}`).flush(emptyHistory);
  }

  it('shows balances and store, with authenticated requests', async () => {
    const { fixture, http } = await setup();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Available points 100');
    expect(text).toContain('Available tokens 20');
    expect(text).toContain('Voucher');
    http.verify();
  });

  it('submits the chosen amount once and refreshes wallet/conversion history', async () => {
    const { component, http } = await setup();
    component['points'] = 12;
    component['convert']();
    component['convert']();
    const request = http.expectOne('/my-rewards/convert');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toMatchObject({ points: 12, requestId: expect.any(String) });
    request.flush({ points: 12, tokens: 12 });
    flushRefresh(http, 'conversion');
    expect(component['message']()).toContain('12 points converted into 12 tokens');
    expect(sessionStorage.getItem(pendingKey)).toBeNull();
    http.verify();
  });

  it.each([-1, 0.5, 101])('rejects invalid conversion amount %s before submitting', async (points) => {
    const { component, http } = await setup();
    component['points'] = points;
    component['convert']();
    expect(component['error']()).toContain('positive whole-number amount');
    http.expectNone('/my-rewards/convert');
    http.verify();
  });

  it('restores an uncertain transaction after reload and retries with the original ID', async () => {
    const { fixture, component, http } = await setup();
    component['points'] = 10;
    component['convert']();
    const request = http.expectOne('/my-rewards/convert');
    const requestId = request.request.body.requestId;
    request.flush({ message: 'Unconfirmed' }, { status: 502, statusText: 'Bad Gateway' });
    expect(component['pending']()?.requestId).toBe(requestId);
    component['points'] = 20;
    component['convert']();
    http.expectNone('/my-rewards/convert');
    fixture.destroy();
    const restored = TestBed.createComponent(MyRewardsPageComponent);
    restored.detectChanges();
    flushRefresh(http, 'award');
    expect(restored.componentInstance['pending']()?.requestId).toBe(requestId);
    restored.componentInstance['retry']();
    const retry = http.expectOne('/my-rewards/convert');
    expect(retry.request.body).toMatchObject({ points: 10, requestId });
    retry.flush({ points: 10, tokens: 10 });
    flushRefresh(http, 'conversion');
    http.verify();
  });

  it('requires active Gold for conversion and redemption but still displays history', async () => {
    const { fixture, component, http } = await setup(false);
    component['points'] = 10;
    component['convert']();
    component['selectedItem'].set(item);
    component['confirmRedemption']();
    http.expectNone('/my-rewards/convert');
    http.expectNone('/my-rewards/redeem');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Active Gold membership is required');
    http.verify();
  });

  it('requires explicit redemption confirmation and sends item version rather than a client price', async () => {
    const { component, http } = await setup();
    component['selectedItem'].set(item);
    http.expectNone('/my-rewards/redeem');
    component['confirmRedemption']();
    const request = http.expectOne('/my-rewards/redeem');
    expect(request.request.body).toMatchObject({ itemId: 'item-1', version: 'v1' });
    expect(request.request.body.tokenCost).toBeUndefined();
    request.flush({
      itemName: 'Voucher', tokens: 15, transactionId: 'ref',
      memberEmailStatus: 'accepted', merchantEmailStatus: 'unconfirmed',
    });
    flushRefresh(http, 'redemption');
    expect(component['message']()).toContain('merchant email: unconfirmed');
    http.verify();
  });

  it('reports rejection without discarding history and clears a definitively rejected request', async () => {
    const { component, http } = await setup();
    component['points'] = 10;
    component['convert']();
    http.expectOne('/my-rewards/convert').flush({ message: 'Not enough available points.' }, { status: 400, statusText: 'Bad Request' });
    expect(component['error']()).toContain('Not enough available points');
    expect(component['pending']()).toBeNull();
    http.verify();
  });

  it('prevents a transaction when recovery details cannot be saved', async () => {
    const { component, http } = await setup();
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    component['points'] = 10;
    component['convert']();
    http.expectNone('/my-rewards/convert');
    expect(component['error']()).toContain('Nothing was submitted');
    storage.mockRestore();
    http.verify();
  });

  it('shows corrupt saved recovery data and blocks spending until explicitly reset', async () => {
    sessionStorage.setItem(pendingKey, '{invalid');
    const { component, http } = await setup();
    expect(component['recoveryBlocked']()).toBe(true);
    component['points'] = 10;
    component['convert']();
    http.expectNone('/my-rewards/convert');
    component['abandonPending']();
    flushRefresh(http, 'award');
    expect(component['recoveryBlocked']()).toBe(false);
    http.verify();
  });

  it('ignores stale history responses and appends the next history page', async () => {
    const { component, http } = await setup();
    component['selectKind']('conversion');
    const old = http.expectOne('/my-rewards/history?kind=conversion');
    component['selectKind']('redemption');
    http.expectOne('/my-rewards/history?kind=redemption').flush({
      records: [{ transactionId: 'a', points: 0, tokens: 5 }], continuationToken: 'next',
    });
    old.flush({ records: [{ transactionId: 'wrong' }], continuationToken: null });
    component['loadHistory'](true);
    http.expectOne('/my-rewards/history?kind=redemption&continuation=next').flush({
      records: [{ transactionId: 'b', points: 0, tokens: 5 }], continuationToken: null,
    });
    expect(component['history']()?.records.map((record) => record.transactionId)).toEqual(['a', 'b']);
    http.verify();
  });

  it('retries only emails with an explicit confirmation, not the purchase', async () => {
    const { component, http } = await setup();
    component['retryEmail']({ transactionId: 'ref', points: 0, tokens: 15, createdAt: '' });
    const request = http.expectOne('/my-rewards/redemptions/ref/email');
    expect(request.request.body).toEqual({ confirmResend: true });
    request.flush({ memberEmailStatus: 'accepted', merchantEmailStatus: 'accepted' });
    http.expectOne('/my-rewards/history?kind=award').flush(emptyHistory);
    http.expectNone('/my-rewards/redeem');
    expect(component['message']()).toContain('No additional tokens were spent');
    http.verify();
  });
});

describe('Rewards store administration', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [StoreAdminPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(StoreAdminPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/admin/store').flush([item]);
    http.expectOne('/admin/redemptions').flush(emptyHistory);
    fixture.detectChanges();
    return { fixture, http, component: fixture.componentInstance };
  }

  it('protects the admin route and exposes a separate member self-service route', () => {
    expect(routes.find((route) => route.path === 'store-admin')?.data?.['allowedRoles']).toEqual(['admin']);
    expect(routes.find((route) => route.path === 'my-rewards')?.data?.['allowedRoles']).toBeUndefined();
  });

  it('edits token price and enabled status using the catalog version', async () => {
    const { component, http } = await setup();
    component['edit'](item);
    component['form'].enabled = false;
    component['form'].tokenCost = 25;
    component['save']();
    const request = http.expectOne('/admin/store/item-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toMatchObject({ tokenCost: 25, enabled: false, version: 'v1' });
    request.flush(item);
    http.expectOne('/admin/store').flush([item]);
    expect(component['message']()).toBe('Store item saved.');
    http.verify();
  });

  it('edits and saves multiple merchant To, CC and BCC addresses', async () => {
    const { fixture, component, http } = await setup();
    component['edit']({
      ...item, merchantEmail: 'shop@example.com; team@example.com',
      merchantCc: 'cc@example.com, backup@example.com', merchantBcc: 'private@example.com',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLInputElement>('input[name=merchantEmail]')?.value).toBe('shop@example.com; team@example.com');
    expect(element.querySelector<HTMLInputElement>('input[name=merchantCc]')?.value).toBe('cc@example.com, backup@example.com');
    expect(element.querySelector<HTMLInputElement>('input[name=merchantBcc]')?.value).toBe('private@example.com');
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
    component['save']();
    const request = http.expectOne('/admin/store/item-1');
    expect(request.request.body).toMatchObject({
      merchantEmail: 'shop@example.com; team@example.com',
      merchantCc: 'cc@example.com, backup@example.com',
      merchantBcc: 'private@example.com', version: 'v1',
    });
    request.flush(item);
    http.expectOne('/admin/store').flush([item]);
    expect(component['form'].merchantCc).toBe('');
    expect(component['form'].merchantBcc).toBe('');
    http.verify();
  });

  it.each([
    ['merchantEmail', ''],
    ['merchantEmail', 'shop@example.com, bad'],
    ['merchantCc', 'bad'],
    ['merchantBcc', 'private@example.com\ninjected@example.com'],
    ['merchantBcc', 'a@example.com'.repeat(1_000)],
    ['merchantEmail', 'x'.repeat(243) + '@example.com'],
  ] as const)('blocks invalid %s before saving', async (field, value) => {
    const { fixture, component, http } = await setup();
    component['edit'](item);
    component['form'][field] = value;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
    component['save']();
    expect(component['error']()).toContain('Merchant');
    http.expectNone('/admin/store/item-1');
    http.verify();
  });

  it('accepts recipient size boundaries and rejects lists that exceed the limit after formatting', async () => {
    const { component, http } = await setup();
    component['edit'](item);
    const addresses = Array.from({ length: 39 }, (_, index) =>
      `${String(index).padStart(2, '0')}${'a'.repeat(240)}@example.com`,
    );
    const list = [...addresses, 'last@example.com'].join(', ');
    expect(addresses[0]).toHaveLength(254);
    expect(list).toHaveLength(10_000);
    component['form'].merchantEmail = list;
    component['form'].merchantCc = list;
    component['form'].merchantBcc = list;
    expect(component['recipientListError']()).toBe('');
    component['form'].merchantBcc = [...addresses, `${'b'.repeat(43)}@example.com`].join(',');
    expect(component['recipientListError']()).toContain('after formatting');
    component['save']();
    http.expectNone('/admin/store/item-1');
    http.verify();
  });

  it('uploads an image before saving a new item', async () => {
    const { fixture, component, http } = await setup();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'reward.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    const upload = http.expectOne('/admin/store-images');
    expect(upload.request.body instanceof FormData).toBe(true);
    upload.flush({ imageUrl: item.imageUrl });
    component['form'].name = 'New reward';
    component['form'].merchantEmail = 'shop@example.com; team@example.com';
    component['form'].merchantCc = 'cc@example.com';
    component['form'].merchantBcc = 'private@example.com';
    component['form'].tokenCost = 5;
    component['save']();
    const save = http.expectOne('/admin/store');
    expect(save.request.body.imageUrl).toBe(item.imageUrl);
    expect(save.request.body).toMatchObject({
      merchantEmail: 'shop@example.com; team@example.com',
      merchantCc: 'cc@example.com', merchantBcc: 'private@example.com',
    });
    save.flush(item);
    http.expectOne('/admin/store').flush([item]);
    http.verify();
  });

  it('displays historical member, merchant, reward, cost and notification details across all redemptions', async () => {
    const { fixture, component, http } = await setup();
    component['loadRedemptions']();
    const request = http.expectOne('/admin/redemptions');
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      records: [{
        transactionId: 'redemption:receipt-1', memberId: 'member-a', memberName: 'Member One',
        memberEmail: 'one@example.com', merchantEmail: 'merchant@example.com',
        merchantCc: 'original-cc@example.com', merchantBcc: 'original-private@example.com',
        itemId: 'old-item', itemName: 'Original voucher', tokens: 15, points: 0,
        createdAt: '2026-11-01T00:00:00Z', memberEmailStatus: 'accepted', merchantEmailStatus: 'unconfirmed',
      }],
      continuationToken: 'next-page',
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Member One');
    expect(element.textContent).toContain('one@example.com');
    expect(element.textContent).toContain('merchant@example.com');
    expect(element.textContent).toContain('original-cc@example.com');
    expect(element.textContent).toContain('original-private@example.com');
    expect(element.textContent).toContain('Original voucher');
    expect(element.textContent).toContain('redemption:receipt-1');
    expect(element.textContent).toContain('unconfirmed');
    expect(element.textContent).toContain('1 redemptions loaded');
    expect(element.querySelector('#all-redemptions')?.textContent).toContain('Tokens spent15');
    http.verify();
  });

  it('appends redemption pages, avoids overlapping loads, and refreshes from the beginning', async () => {
    const { component, http } = await setup();
    component['loadRedemptions']();
    component['loadRedemptions']();
    http.expectOne('/admin/redemptions').flush({
      records: [{ transactionId: 'a', memberId: 'member-a' }], continuationToken: 'next',
    });
    component['loadRedemptions'](true);
    http.expectOne('/admin/redemptions?continuation=next').flush({
      records: [{ transactionId: 'b', memberId: 'member-b' }], continuationToken: null,
    });
    expect(component['redemptions']()?.records.map((record) => record.transactionId)).toEqual(['a', 'b']);
    component['loadRedemptions'](true);
    http.expectNone('/admin/redemptions');
    component['loadRedemptions']();
    http.expectOne('/admin/redemptions').flush(emptyHistory);
    expect(component['redemptions']()?.records).toEqual([]);
    http.verify();
  });

  it('keeps continuation on an empty page and makes load failures explicit without discarding existing records', async () => {
    const { fixture, component, http } = await setup();
    component['loadRedemptions']();
    http.expectOne('/admin/redemptions').flush({ records: [], continuationToken: 'scan-next' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Load more to continue checking');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('No redemptions recorded.');
    component['loadRedemptions'](true);
    http.expectOne('/admin/redemptions?continuation=scan-next').flush({
      records: [{ transactionId: 'a', memberId: 'member-a' }], continuationToken: 'retry-next',
    });
    component['loadRedemptions'](true);
    http.expectOne('/admin/redemptions?continuation=retry-next').flush(
      { message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' },
    );
    expect(component['redemptionsError']()).toBe('Storage unavailable');
    expect(component['redemptions']()?.records).toHaveLength(1);
    expect(component['redemptions']()?.continuationToken).toBe('retry-next');
    expect(component['loadingRedemptions']()).toBe(false);
    http.verify();
  });
});
