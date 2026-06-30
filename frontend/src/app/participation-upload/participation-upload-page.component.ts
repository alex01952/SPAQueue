import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { finalize, timeout } from 'rxjs';
import { DashboardAuthService } from '../dashboard-auth.service';
import { getApiBaseUrl } from '../api-base-url';

interface MonthlyParticipationUploadConfig {
  storageAccount: string | null;
  containerName: string | null;
  prefix: string;
  months: string[];
}

interface UploadedParticipationFile {
  fileName: string;
  blobName: string;
  size: number;
}

interface MonthlyParticipationUploadResult {
  targetPath: string;
  uploadedFiles: UploadedParticipationFile[];
}

@Component({
  selector: 'app-participation-upload-page',
  imports: [],
  templateUrl: './participation-upload-page.component.html',
  styleUrl: './participation-upload-page.component.scss',
})
export class ParticipationUploadPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly dashboardAuth = inject(DashboardAuthService);
  private readonly apiBaseUrl = getApiBaseUrl();

  protected readonly isLoadingConfig = signal(true);
  protected readonly isUploading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly storageAccount = signal<string | null>(null);
  protected readonly containerName = signal<string | null>(null);
  protected readonly prefix = signal('');
  protected readonly monthOptions = signal<string[]>([]);
  protected readonly selectedMonth = signal('');
  protected readonly selectedFiles = signal<File[]>([]);
  protected readonly uploadResult = signal<MonthlyParticipationUploadResult | null>(null);
  protected readonly isConfigured = computed(
    () => Boolean(this.storageAccount()) && Boolean(this.containerName()),
  );
  protected readonly targetPath = computed(() =>
    [this.prefix(), this.selectedMonth()].filter((segment) => segment.length > 0).join('/'),
  );

  ngOnInit() {
    this.loadUploadConfig();
  }

  protected loadUploadConfig() {
    this.isLoadingConfig.set(true);
    this.errorMessage.set('');

    this.http
      .get<MonthlyParticipationUploadConfig>(
        `${this.apiBaseUrl}/participation/monthly/upload-config`,
        { headers: this.dashboardAuth.getAuthHeaders() },
      )
      .subscribe({
        next: (config) => {
          this.storageAccount.set(config.storageAccount);
          this.containerName.set(config.containerName);
          this.prefix.set(config.prefix);
          this.monthOptions.set(config.months);
          this.selectedMonth.set(this.getDefaultMonth(config.months));
          this.isLoadingConfig.set(false);
        },
        error: (error) => {
          this.isLoadingConfig.set(false);
          this.errorMessage.set(
            error?.error?.message || 'Unable to load the Azure Storage upload configuration.',
          );
        },
      });
  }

  protected updateSelectedMonth(month: string) {
    this.selectedMonth.set(month);
    this.uploadResult.set(null);
    this.successMessage.set('');
  }

  protected updateSelectedFiles(fileList: FileList | null) {
    this.selectedFiles.set(fileList ? Array.from(fileList) : []);
    this.uploadResult.set(null);
    this.successMessage.set('');
  }

  protected uploadFiles() {
    if (!this.selectedMonth() || !this.selectedFiles().length || !this.isConfigured()) {
      return;
    }

    const formData = new FormData();

    formData.append('month', this.selectedMonth());
    for (const file of this.selectedFiles()) {
      formData.append('files', file, file.name);
    }

    this.isUploading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.uploadResult.set(null);

    this.http
      .post<MonthlyParticipationUploadResult>(
        `${this.apiBaseUrl}/participation/monthly/uploads`,
        formData,
        { headers: this.dashboardAuth.getAuthHeaders() },
      )
      .pipe(
        timeout(45000),
        finalize(() => this.isUploading.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.uploadResult.set(result);
          this.successMessage.set(
            `${result.uploadedFiles.length} file${result.uploadedFiles.length === 1 ? '' : 's'} uploaded.`,
          );
          this.selectedFiles.set([]);
        },
        error: (error) => {
          this.errorMessage.set(this.getUploadErrorMessage(error));
        },
      });
  }

  protected formatFileSize(size: number) {
    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getDefaultMonth(months: string[]) {
    const currentMonth = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date());

    return months.includes(currentMonth) ? currentMonth : (months[0] ?? '');
  }

  private getUploadErrorMessage(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'TimeoutError'
    ) {
      return 'The upload timed out. Check that the API can authenticate to Azure Storage and has write access to the container.';
    }

    if (typeof error === 'object' && error !== null && 'error' in error) {
      const httpError = error as { status?: number; error?: { message?: string } };

      if (httpError.status === 401) {
        this.dashboardAuth.clearPassword();
      }

      return httpError.error?.message || 'Unable to upload the selected files.';
    }

    return 'Unable to upload the selected files.';
  }
}
