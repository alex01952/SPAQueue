import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, timeout } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { OpenPlayGender } from './open-play-matching';
import { OpenPlayCategory } from './open-play-players';

export interface ImportPreset {
  id: string;
  reClubName: string;
  category: OpenPlayCategory;
  gender: Exclude<OpenPlayGender, ''>;
}

export function normalizeImportName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class OpenPlayImportPresetsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${getApiBaseUrl()}/open-play/import-presets`;

  list() {
    return this.http.get<ImportPreset[]>(this.url, { withCredentials: true }).pipe(
      timeout(20000),
      map((presets) => {
        if (!Array.isArray(presets)) throw new Error('Invalid import preset list');
        return presets;
      }),
    );
  }

  save(preset: Omit<ImportPreset, 'id'>) {
    return this.http.put<ImportPreset>(this.url, preset, { withCredentials: true }).pipe(timeout(20000));
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`, { withCredentials: true }).pipe(timeout(20000));
  }
}
