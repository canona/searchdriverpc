import type { DriverExportResult, ExportAllProgress } from '../../electron/types';
import { formatBytes, useDriverDownloads } from '../hooks/useDriverDownloads';

interface Props {
  running: boolean;
  progress: ExportAllProgress | null;
  result: DriverExportResult | null;
  error: string | null;
  onCancel: () => void;
  onClose: () => void;
}

/** Tiến trình + kết quả "Export tất cả driver". */
export function ExportAllPanel({ running, progress, result, error, onCancel, onClose }: Props) {
  const { openFolder } = useDriverDownloads();
  const pct = progress && progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <section className="panel" aria-live="polite">
      <header className="panel-head">
        <h2>Export tất cả driver</h2>
        <div className="panel-actions">
          {running ? (
            <button className="btn btn-sm" onClick={onCancel}>
              Hủy
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          )}
        </div>
      </header>

      <p className="muted small">
        Sao chép mọi driver bên thứ ba đang cài (các gói oem*.inf trong Driver Store) bằng <span className="mono">pnputil</span>.
        Driver có sẵn của Windows không cần sao lưu. Không thay đổi gì trên máy.
      </p>

      {running && (
        <div className="progress-line small">
          <div className="progress-text">
            <span className="spinner" aria-hidden /> Đang export{' '}
            {progress ? `${progress.done}/${progress.total} gói` : '…'} — có thể mất vài phút.
          </div>
          <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {error && <p className="error-text small">{error}</p>}

      {result?.saved && result.folder && (
        <div className="downloaded ok">
          <ul className="checks">
            <li className="pass">
              Đã export {result.exported}/{result.total} gói driver ({formatBytes(result.sizeBytes)})
            </li>
            <li className="pass">Kèm DANH-SACH-DRIVER.csv (thiết bị ↔ gói) và HUONG-DAN-KHOI-PHUC.txt</li>
          </ul>
          <div className="downloaded-actions">
            <button className="btn btn-sm" onClick={() => void openFolder(result.folder!)}>
              Mở thư mục ↗
            </button>
            <span className="muted small mono" title={result.folder}>
              {result.folder}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
