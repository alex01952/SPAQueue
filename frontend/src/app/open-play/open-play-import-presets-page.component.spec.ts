import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { OpenPlayImportPresetsPageComponent } from './open-play-import-presets-page.component';

describe('OpenPlayImportPresetsPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpenPlayImportPresetsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads, adds, edits and removes shared presets', async () => {
    const fixture = TestBed.createComponent(OpenPlayImportPresetsPageComponent);
    const component = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const load = http.expectOne((entry) => entry.url.endsWith('/open-play/import-presets') && entry.method === 'GET');
    expect(load.request.withCredentials).toBe(true);
    load.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    component['presetName'].set('Guest Player');
    component['presetCategory'].set('Novice');
    component['presetGender'].set('Female');
    fixture.detectChanges();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('.preset-form [type="submit"]')!.click();
    const create = http.expectOne((entry) => entry.url.endsWith('/open-play/import-presets') && entry.method === 'PUT');
    expect(create.request.body).toEqual({ reClubName: 'Guest Player', category: 'Novice', gender: 'Female' });
    const preset = { id: 'saved-preset', reClubName: 'Guest Player', category: 'Novice', gender: 'Female' };
    create.flush(preset);
    await fixture.whenStable();
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('[aria-label="Edit preset for Guest Player"]')!.click();
    component['presetCategory'].set('Intermediate');
    fixture.detectChanges();
    const edit = component['saveImportPreset']();
    const update = http.expectOne((entry) => entry.url.endsWith('/open-play/import-presets') && entry.method === 'PUT');
    expect(update.request.body).toEqual({ reClubName: 'Guest Player', category: 'Intermediate', gender: 'Female' });
    update.flush({ ...preset, category: 'Intermediate' });
    await edit;
    fixture.detectChanges();
    expect(root.querySelector('.preset-list')?.textContent).toContain('Intermediate');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      root.querySelector<HTMLButtonElement>('[aria-label="Remove preset for Guest Player"]')!.click();
      http.expectOne((entry) => entry.url.endsWith('/open-play/import-presets/saved-preset') && entry.method === 'DELETE')
        .flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(root.querySelector('.preset-list')?.textContent).toContain('No presets yet');
    } finally {
      confirm.mockRestore();
    }
  });

  it('offers retry when presets cannot load', async () => {
    const fixture = TestBed.createComponent(OpenPlayImportPresetsPageComponent);
    fixture.detectChanges();
    http.expectOne((entry) => entry.method === 'GET').flush({}, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Unable to load import presets');
    root.querySelector<HTMLButtonElement>('button')!.click();
    http.expectOne((entry) => entry.method === 'GET').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.preset-list')?.textContent).toContain('No presets yet');
  });
});
