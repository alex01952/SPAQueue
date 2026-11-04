import { TestBed } from '@angular/core/testing';
import { TournamentPricingComponent } from './tournament-pricing.component';
import { pricingFromForm, tournamentPricingForm } from './tournament-pricing-editor.component';

describe('Tournament fee details', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function render(now: string, regularPrice = 500) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const fixture = TestBed.createComponent(TournamentPricingComponent);
    fixture.componentRef.setInput('pricing', { regularPrice, earlyBirdPrice: 400, earlyBirdEndDate: '2026-10-31' });
    fixture.detectChanges();
    return fixture;
  }

  it.each([
    ['2026-10-30T16:00:00.000Z', true],
    ['2026-10-31T15:59:59.999Z', true],
    ['2026-10-31T16:00:00.000Z', false],
  ])('uses the inclusive Manila date independently of local timezone at %s', (now, active) => {
    const fixture = render(now);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain(`Registration fee: ₱${active ? '400' : '500'}.00 per player (${active ? 'early bird' : 'regular'})`);
    expect(text).toContain('Regular price: ₱500.00 per player');
    expect(text).toContain('Early-bird price: ₱400.00 per player');
    expect(text).toContain('October 31, 2026 at 11:59 PM Philippine time (UTC+8)');
    fixture.destroy();
  });

  it('switches to the regular fee while the page remains open and cleans up its clock', () => {
    const fixture = render('2026-10-31T15:59:59.000Z');
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Registration fee: ₱500.00 per player (regular)');
    expect(fixture.nativeElement.textContent).toContain('Early-bird pricing has ended.');
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes unannounced fees from explicitly free regular and early-bird fees', () => {
    const fixture = TestBed.createComponent(TournamentPricingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('not yet announced');
    fixture.componentRef.setInput('pricing', { regularPrice: 0 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('₱0.00 per player (regular)');
    fixture.componentRef.setInput('pricing', { regularPrice: 500, earlyBirdPrice: 0, earlyBirdEndDate: '9999-12-31' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('₱0.00 per player (early bird)');
    fixture.destroy();
  });
});

describe('Tournament fee editor validation', () => {
  it('initializes, preserves cents and zero, and supports clearing all fees', () => {
    expect(pricingFromForm(tournamentPricingForm())).toBeNull();
    expect(pricingFromForm(tournamentPricingForm({ regularPrice: 0 }))).toEqual({ regularPrice: 0 });
    const pricing = { regularPrice: 500.25, earlyBirdPrice: 0, earlyBirdEndDate: '2028-02-29' };
    expect(pricingFromForm(tournamentPricingForm(pricing))).toEqual(pricing);
  });

  it.each([
    { regularPrice: null, earlyBirdPrice: 100, earlyBirdEndDate: '2026-10-31' },
    { regularPrice: 500, earlyBirdPrice: 100, earlyBirdEndDate: '' },
    { regularPrice: 500, earlyBirdPrice: null, earlyBirdEndDate: '2026-10-31' },
    { regularPrice: 500, earlyBirdPrice: 501, earlyBirdEndDate: '2026-10-31' },
    { regularPrice: 500, earlyBirdPrice: 100, earlyBirdEndDate: '2026-02-29' },
    { regularPrice: -1, earlyBirdPrice: null, earlyBirdEndDate: '' },
    { regularPrice: 1.001, earlyBirdPrice: null, earlyBirdEndDate: '' },
    { regularPrice: Infinity, earlyBirdPrice: null, earlyBirdEndDate: '' },
  ])('rejects incomplete or invalid price settings: %j', (form) => {
    expect(() => pricingFromForm(form)).toThrow();
  });
});
