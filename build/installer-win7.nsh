; Kiểm tra phiên bản Windows trước khi cài bản Win7 (electron-builder chèn vào bộ cài NSIS).
; Electron 22 cần tối thiểu Windows 7 Service Pack 1.
!include "WinVer.nsh"

!macro customInit
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_ICONSTOP "SearchDriverPC cần Windows 7 SP1 trở lên."
    Quit
  ${EndIf}
  ${If} ${IsWin7}
  ${AndIfNot} ${AtLeastServicePack} 1
    MessageBox MB_ICONSTOP "Máy đang chạy Windows 7 chưa có Service Pack 1.$\r$\nHãy cài Windows 7 SP1 (KB976932) qua Windows Update rồi chạy lại bộ cài."
    Quit
  ${EndIf}
!macroend
