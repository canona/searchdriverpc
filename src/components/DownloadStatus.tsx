import type { DownloadedDriver, DownloadProgress } from '../../electron/types';
import { formatBytes, PHASE_LABEL, useDriverDownloads } from '../hooks/useDriverDownloads';

export function ProgressLine({ progress }: { progress?: DownloadProgress }) {
  if (!progress) {
    return (
      <div className="progress-line muted small">
        <span className="spinner" aria-hidden /> Đang chuẩn bị…
      </div>
    );
  }
  const pct =
    progress.phase === 'downloading' && progress.totalBytes
      ? Math.min(100, (progress.receivedBytes / progress.totalBytes) * 100)
      : null;
  return (
    <div className="progress-line small">
      <div className="progress-text">
        <span className="spinner" aria-hidden /> {PHASE_LABEL[progress.phase]}
        {progress.phase === 'downloading' &&
          ` ${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`}
      </div>
      {pct !== null && (
        <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Kết quả một gói đã tải: các bước xác minh + mở thư mục + cách tự cài. */
export function DownloadedCard({ driver }: { driver: DownloadedDriver }) {
  const { openFolder } = useDriverDownloads();
  return (
    <div className={`downloaded ${driver.infMatched ? 'ok' : 'warn'}`}>
      <ul className="checks">
        <li className={driver.hashVerified ? 'pass' : 'warn'}>
          {driver.hashVerified ? 'Hash khớp với catalog' : 'Catalog không công bố hash cho gói này'}
        </li>
        <li className="pass">Chữ ký số hợp lệ: {driver.signer.replace(/,.*$/, '')}</li>
        <li className={driver.infMatched ? 'pass' : 'warn'}>
          {driver.infMatched
            ? `INF khớp Hardware ID (${driver.matchedInfFiles.slice(0, 3).join(', ')}${driver.matchedInfFiles.length > 3 ? '…' : ''})`
            : 'Không tìm thấy Hardware ID của thiết bị trong file .inf — có thể không đúng thiết bị'}
        </li>
      </ul>
      <div className="downloaded-actions">
        <button className="btn btn-sm" onClick={() => void openFolder(driver.folder)}>
          Mở thư mục ↗
        </button>
        <span className="muted small mono" title={driver.folder}>
          {driver.folder}
        </span>
      </div>
      <p className="muted small install-hint">
        Chưa cài. Để tự cài: Device Manager → chuột phải thiết bị → Update driver → Browse my computer → chọn thư mục{' '}
        <b>driver</b> trong thư mục trên.
      </p>
    </div>
  );
}
