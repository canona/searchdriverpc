import { useEffect, useState } from 'react';
import type { DeviceInfo, DriverExportResult, InstalledDriverInfo } from '../../electron/types';
import { errorMessage, getApi } from '../api';
import { formatBytes, useDriverDownloads } from '../hooks/useDriverDownloads';

/** Driver đang cài của một thiết bị + nút export (sao lưu) ra thư mục người dùng chọn. */
export function InstalledDriverSection({ device }: { device: DeviceInfo }) {
  const { openFolder } = useDriverDownloads();
  const [info, setInfo] = useState<InstalledDriverInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<DriverExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chỉ đọc khi người dùng mở chi tiết thiết bị (component này chỉ render lúc đó).
  useEffect(() => {
    let alive = true;
    getApi()
      .getInstalledDriver(device.id)
      .then((r) => alive && setInfo(r))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [device.id]);

  const doExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const r = await getApi().exportDeviceDriver(device.id);
      if (r.saved) setResult(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="driver-search">
      <div className="driver-search-head">
        <b>Driver đang cài</b>
        <button
          className="btn btn-sm"
          disabled={!info?.infName || exporting}
          title={info?.infName ? 'Sao chép gói driver này ra thư mục bạn chọn' : 'Thiết bị chưa có driver'}
          onClick={() => void doExport()}
        >
          {exporting ? 'Đang export…' : 'Export driver này…'}
        </button>
      </div>
      {!info && !error && <p className="muted small">Đang đọc thông tin driver…</p>}
      {info &&
        (info.infName ? (
          <p className="small">
            <span className="mono">{info.infName}</span> · {info.provider ?? '—'} · phiên bản {info.version ?? '—'} · ngày{' '}
            {info.date ?? '—'}
          </p>
        ) : (
          <p className="muted small">Chưa có driver nào được cài cho thiết bị này.</p>
        ))}
      {error && <p className="error-text small">{error}</p>}
      {result?.folder && (
        <div className="downloaded ok">
          <ul className="checks">
            <li className="pass">Đã export ({formatBytes(result.sizeBytes)})</li>
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
    </div>
  );
}
