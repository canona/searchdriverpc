import { useCallback, useEffect, useState } from 'react';
import type { DriverExportResult, ExportAllProgress } from '../../electron/types';
import { errorMessage, getApi } from '../api';

/** Trạng thái "Export tất cả driver" (pnputil /export-driver *). */
export function useExportAll() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportAllProgress | null>(null);
  const [result, setResult] = useState<DriverExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.driverApi?.onExportAllProgress(setProgress), []);

  /** Trả false nếu người dùng hủy ở hộp chọn thư mục. */
  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    setResult(null);
    setProgress(null);
    setRunning(true);
    try {
      const r = await getApi().exportAllDrivers();
      if (!r.saved) return false;
      setResult(r);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return true;
    } finally {
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => void getApi().cancelExportAll(), []);

  return { running, progress, result, error, start, cancel };
}
