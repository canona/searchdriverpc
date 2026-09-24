import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExportFormat } from '../electron/types';
import { errorMessage, getApi } from './api';
import { AutoFindPanel } from './components/AutoFindPanel';
import { DeviceList } from './components/DeviceList';
import { ExportAllPanel } from './components/ExportAllPanel';
import { WindowsUpdatePanel } from './components/WindowsUpdatePanel';
import { canSearchCatalog, useDriverDownloads } from './hooks/useDriverDownloads';
import { useExportAll } from './hooks/useDriverExport';
import { useHardwareScan } from './hooks/useHardwareScan';
import { useTheme } from './hooks/useTheme';
import { matchDevice, useWindowsUpdate } from './hooks/useWindowsUpdate';

interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const { result, loading, error, scan } = useHardwareScan();
  const wu = useWindowsUpdate();
  const [showWu, setShowWu] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const drivers = useDriverDownloads();
  const exportAll = useExportAll();
  const [showExportAll, setShowExportAll] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const devices = useMemo(() => result?.devices ?? [], [result]);
  const problemCount = devices.filter((d) => d.status !== 'ok').length;
  const searchable = useMemo(() => devices.filter(canSearchCatalog), [devices]);

  // Lỗi từ các thao tác tải (đổi thư mục, mở thư mục) hiển thị qua notice chung.
  useEffect(() => {
    if (drivers.lastError) setNotice({ kind: 'error', text: drivers.lastError });
  }, [drivers.lastError]);

  // Đánh dấu các thiết bị có driver đang chờ trên Windows Update.
  const windowsUpdateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const u of wu.result?.updates ?? []) {
      const d = matchDevice(u.hardwareId, devices);
      if (d) ids.add(d.id);
    }
    return ids;
  }, [wu.result, devices]);

  const openLink = useCallback(async (url: string) => {
    try {
      await getApi().openExternal(url);
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    }
  }, []);

  const exportList = async (format: ExportFormat) => {
    try {
      const r = await getApi().exportDevices(format);
      if (r.saved) setNotice({ kind: 'info', text: `Đã lưu ${r.count} thiết bị vào ${r.filePath}` });
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    }
  };

  const checkWu = () => {
    setShowWu(true);
    void wu.check();
  };

  const sys = result?.system;
  const machine = [sys?.manufacturer, sys?.model].filter(Boolean).join(' ');
  const board = [sys?.boardManufacturer, sys?.boardProduct].filter(Boolean).join(' ');

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>SearchDriverPC</h1>
          <p className="muted small">
            {machine || board ? (
              <>
                {machine && <span>Máy: {machine}</span>}
                {machine && board && ' · '}
                {board && <span>Bo mạch: {board}</span>}
                {sys?.oemLink && (
                  <>
                    {' · '}
                    <button className="link" onClick={() => void openLink(sys.oemLink!.url)}>
                      {sys.oemLink.label} ↗
                    </button>
                  </>
                )}
              </>
            ) : (
              'Quét phần cứng và tìm trang tải driver chính chủ'
            )}
          </p>
        </div>

        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => void scan()} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" aria-hidden /> Đang quét…
              </>
            ) : (
              'Quét lại'
            )}
          </button>
          <button
            className="btn"
            onClick={() => setShowAuto(true)}
            disabled={!result || drivers.bulkRunning}
            title="Tìm trên Microsoft Update Catalog và tải gói driver (không cài) cho các thiết bị lỗi"
          >
            {drivers.bulkRunning ? 'Đang tải driver…' : `Tự tìm & tải driver (${searchable.length})`}
          </button>
          <button
            className="btn"
            onClick={() => {
              setShowExportAll(true);
              void exportAll.start().then((picked) => !picked && setShowExportAll(false));
            }}
            disabled={exportAll.running}
            title="Sao lưu toàn bộ driver đang cài ra thư mục bạn chọn"
          >
            {exportAll.running ? 'Đang export driver…' : 'Export tất cả driver'}
          </button>
          <button className="btn" onClick={checkWu} disabled={wu.loading}>
            {wu.loading ? 'Đang kiểm tra…' : 'Kiểm tra qua Windows Update'}
          </button>
          <div className="btn-group" role="group" aria-label="Xuất danh sách thiết bị lỗi">
            <button
              className="btn"
              onClick={() => void exportList('csv')}
              disabled={!result}
              title="Xuất danh sách thiết bị thiếu driver/lỗi"
            >
              Danh sách .csv
            </button>
            <button className="btn" onClick={() => void exportList('txt')} disabled={!result}>
              .txt
            </button>
          </div>
          <button
            className="btn btn-icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            aria-label="Đổi giao diện sáng/tối"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          {notice.text}
          <button className="link" onClick={() => setNotice(null)} aria-label="Đóng thông báo">
            ✕
          </button>
        </div>
      )}

      {result && (
        <div className="summary">
          <b>{devices.length}</b> thiết bị ·{' '}
          <b className={problemCount ? 'text-warn' : 'text-ok'}>{problemCount}</b> cần chú ý
          {result.skippedDisconnected > 0 && ` · bỏ qua ${result.skippedDisconnected} thiết bị không kết nối`}
          {' · '}quét lúc {new Date(result.scannedAt).toLocaleTimeString('vi-VN')}
          {!result.idDatabaseLoaded && <span className="text-warn"> · Không đọc được pci.ids — thiếu tên tra cứu</span>}
        </div>
      )}

      {showAuto && result && <AutoFindPanel devices={searchable} onClose={() => setShowAuto(false)} />}

      {showExportAll && (exportAll.progress || exportAll.result || exportAll.error) && (
        <ExportAllPanel {...exportAll} onCancel={exportAll.cancel} onClose={() => setShowExportAll(false)} />
      )}

      {showWu && (
        <WindowsUpdatePanel
          result={wu.result}
          loading={wu.loading}
          error={wu.error}
          devices={devices}
          onOpenSettings={() => void getApi().openWindowsUpdateSettings()}
          onClose={() => setShowWu(false)}
        />
      )}

      {error && (
        <div className="panel error-panel">
          <b>Quét thất bại:</b> {error}
        </div>
      )}

      {!result && loading && (
        <div className="loading-state">
          <span className="spinner spinner-lg" aria-hidden />
          <p>Đang đọc danh sách thiết bị qua WMI…</p>
        </div>
      )}

      {result && <DeviceList devices={devices} windowsUpdateIds={windowsUpdateIds} onOpenLink={openLink} />}

      <footer className="app-footer muted small">
        App chỉ tải gói driver có chữ ký Microsoft từ Microsoft Update Catalog và không bao giờ tự cài hay chạy file nào. Các
        nút trang hãng chỉ mở trình duyệt để bạn tự quyết.
      </footer>
    </div>
  );
}
