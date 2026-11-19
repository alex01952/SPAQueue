import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ImportPreset, normalizeImportName, OpenPlayImportPresetsService } from './open-play-import-presets';
import { OpenPlayGender } from './open-play-matching';
import { OpenPlayCategory } from './open-play-players';

@Component({
  selector: 'app-open-play-import-presets-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './open-play-import-presets-page.component.html',
  styleUrls: ['./open-play-page.component.scss', './open-play-import-presets-page.component.scss'],
})
export class OpenPlayImportPresetsPageComponent implements OnInit {
  private readonly presetsService = inject(OpenPlayImportPresetsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly categories: OpenPlayCategory[] = ['Novice', 'Intermediate', 'High Intermediate'];
  protected readonly importPresets = signal<ImportPreset[] | null>(null);
  protected readonly presetsBusy = signal(false);
  protected readonly presetError = signal('');
  protected readonly presetName = signal('');
  protected readonly presetCategory = signal<OpenPlayCategory | ''>('');
  protected readonly presetGender = signal<OpenPlayGender>('');
  protected readonly editingPresetId = signal('');
  protected readonly duplicatePreset = computed(() => {
    const name = normalizeImportName(this.presetName());
    return this.importPresets()?.find((preset) => preset.id !== this.editingPresetId() && normalizeImportName(preset.reClubName) === name);
  });

  ngOnInit() {
    void this.loadImportPresets();
  }

  protected async loadImportPresets() {
    if (this.presetsBusy()) return;
    this.presetsBusy.set(true);
    this.presetError.set('');
    try {
      this.importPresets.set(await firstValueFrom(this.presetsService.list().pipe(takeUntilDestroyed(this.destroyRef))));
    } catch {
      this.importPresets.set(null);
      this.presetError.set('Unable to load import presets. Try again.');
    } finally {
      this.presetsBusy.set(false);
    }
  }

  protected editImportPreset(preset?: ImportPreset) {
    this.editingPresetId.set(preset?.id ?? '');
    this.presetName.set(preset?.reClubName ?? '');
    this.presetCategory.set(preset?.category ?? '');
    this.presetGender.set(preset?.gender ?? '');
    this.presetError.set('');
  }

  protected async saveImportPreset() {
    const reClubName = this.presetName().trim();
    const category = this.presetCategory();
    const gender = this.presetGender();
    if (this.presetsBusy() || !this.importPresets() || !reClubName || !category || !gender || this.duplicatePreset()) return;
    this.presetsBusy.set(true);
    this.presetError.set('');
    try {
      const saved = await firstValueFrom(this.presetsService.save({ reClubName, category, gender }).pipe(takeUntilDestroyed(this.destroyRef)));
      this.importPresets.update((presets) => [...(presets ?? []).filter((preset) => preset.id !== saved.id), saved]
        .sort((left, right) => left.reClubName.localeCompare(right.reClubName)));
      this.editImportPreset();
    } catch {
      this.presetError.set('Unable to save the import preset. Try again.');
    } finally {
      this.presetsBusy.set(false);
    }
  }

  protected async deleteImportPreset(preset: ImportPreset) {
    if (this.presetsBusy() || !window.confirm(`Remove the import preset for ${preset.reClubName}?`)) return;
    this.presetsBusy.set(true);
    this.presetError.set('');
    try {
      await firstValueFrom(this.presetsService.delete(preset.id).pipe(takeUntilDestroyed(this.destroyRef)));
      this.importPresets.update((presets) => presets?.filter((entry) => entry.id !== preset.id) ?? null);
      if (this.editingPresetId() === preset.id) this.editImportPreset();
    } catch {
      this.presetError.set('Unable to remove the import preset. Try again.');
    } finally {
      this.presetsBusy.set(false);
    }
  }
}
