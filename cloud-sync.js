/* Public read access with authenticated, allowlisted editing for Manawib. */
(function () {
  'use strict';

  const url = window.MANAWIB_SUPABASE_URL || '';
  const key = window.MANAWIB_SUPABASE_KEY || '';
  const localPreview = window.location.protocol === 'file:';
  const localEmployees = JSON.parse(JSON.stringify(employees));
  const localHolidays = JSON.parse(JSON.stringify(holidays));
  let client, user = null;
  let employeeBaseline = new Map(), privateBaseline = new Map(), holidayBaseline = new Map();
  let syncQueue = Promise.resolve();
  let pendingAction = null;
  let unlockTimer = null;
  let hiddenAt = null;

  const style = document.createElement('style');
  style.textContent = '.cloud-gate{position:fixed;inset:0;z-index:20;background:#f5f7f4ed;display:grid;place-items:center;padding:18px;direction:rtl;font-family:Tahoma,Arial,sans-serif;color:#20312d}.cloud-card{width:min(460px,100%);background:#fff;border:1px solid #e5ebe7;border-radius:18px;padding:24px;box-shadow:0 12px 36px #253c3010}.cloud-card h1{font-size:21px;margin:0 0 8px}.cloud-card p{font-size:14px;line-height:1.8;color:#71817b}.cloud-card label{display:block;font-size:13px;margin:12px 0 5px}.cloud-card input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #dce4de;border-radius:9px;font:inherit}.cloud-card button{border:0;border-radius:9px;padding:11px 15px;background:#16795b;color:white;font:inherit;cursor:pointer;margin-top:14px}.cloud-card button.secondary{background:#e9f4ee;color:#16795b;margin-right:6px}.cloud-card button:disabled{opacity:.55;cursor:wait}.cloud-error{color:#aa3936!important}.cloud-note{font-size:12px!important}.cloud-actions{display:flex;flex-wrap:wrap;gap:6px}.cloud-gate[hidden]{display:none}.cloud-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cloud-controls .button{white-space:nowrap}.directory-mode .stats,.directory-mode #detail .profile .actions{display:none!important}.code-overlay{position:fixed;inset:0;z-index:19;background:#13272080;display:grid;place-items:center;padding:18px;direction:rtl;font-family:Tahoma,Arial,sans-serif}.code-card{width:min(410px,100%);background:#fff;border-radius:18px;padding:22px;box-shadow:0 16px 50px #13272030}.code-card h2{margin:0 0 8px;font-size:20px}.code-card p{color:#6a7b74;line-height:1.8;font-size:14px}.code-card input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #dce4de;border-radius:10px;font:inherit;letter-spacing:.12em;text-transform:uppercase}.code-card .code-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.code-card button{border:0;border-radius:9px;padding:10px 14px;background:#16795b;color:white;font:inherit;cursor:pointer}.code-card button.secondary{background:#edf3ef;color:#456057}.one-time-code{font-size:22px!important;font-weight:700;letter-spacing:.16em;text-align:center;padding:14px;background:#f1f7f3;border-radius:10px;color:#16795b!important;direction:ltr}.directory-mode .employee .emp-main small,.directory-mode .employee .leave-count{display:none!important}';
  document.head.appendChild(style);
  style.textContent += '.cloud-status{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 20px;padding:10px 12px;border-radius:10px;background:#fff1ef;color:#8c3430;font-size:13px}.cloud-status button{border:0;border-radius:8px;padding:7px 11px;background:#16795b;color:#fff;font:inherit;white-space:nowrap}';
  // A previous release cached complete employee records locally. Keep the snapshot
  // only for an explicit administrator import and remove the browser copy afterwards.
  localStorage.removeItem('manawib_employees_v1');
  localStorage.removeItem('manawib_oman_holidays_v1');
  const gate = document.createElement('main');
  gate.className = 'cloud-gate';
  gate.hidden = true;
  document.body.appendChild(gate);

  function show(html) { gate.innerHTML = '<section class="cloud-card">' + html + '</section>'; gate.hidden = false; }
  function message(text, error) {
    const el = document.getElementById('cloudMessage');
    if (el) { el.textContent = text; el.className = error ? 'cloud-error' : 'cloud-note'; }
  }
  function showConnectionStatus(text, retry = false) {
    const shell = document.querySelector('.shell');
    let status = document.getElementById('cloudStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'cloudStatus';
      status.className = 'cloud-status';
      status.setAttribute('role','status');
      shell.insertBefore(status, shell.children[1] || null);
    }
    status.replaceChildren();
    const label = document.createElement('span');
    label.textContent = text;
    status.appendChild(label);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'إعادة المحاولة';
      button.onclick = () => window.location.reload();
      status.appendChild(button);
    }
  }
  function withTimeout(promise, milliseconds = 15000) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('تعذر تحديث البيانات حالياً.')), milliseconds);
      })
    ]).finally(() => clearTimeout(timer));
  }
  function readPublicCache() {
    try {
      const cached = JSON.parse(localStorage.getItem('manawib_public_cache_v1') || 'null');
      if (!cached || !Array.isArray(cached.employees)) return null;
      return {
        employees: cached.employees.filter(e => e && typeof e.id === 'string' && typeof e.name === 'string')
          .map(({id,name}) => ({id,name})),
        holidays: Array.isArray(cached.holidays)
          ? cached.holidays.filter(h => h && typeof h.name === 'string' && typeof h.start === 'string' && typeof h.end === 'string')
              .map(h => ({id:h.id,name:h.name,start:h.start,end:h.end,source:h.source||''}))
          : officialHolidays()
      };
    } catch { return null; }
  }
  function savePublicCache() {
    try {
      localStorage.setItem('manawib_public_cache_v1', JSON.stringify({
        employees: employees.filter(e => e && typeof e.name === 'string').map(({id,name}) => ({id,name})),
        holidays: holidays.map(h => ({id:h.id,name:h.name,start:h.start,end:h.end,source:h.source||''}))
      }));
    } catch { /* The live directory still works if storage is unavailable. */ }
  }
  function showPublicError(errorText) {
    startApp();
    showConnectionStatus(errorText || 'تعذر تحديث البيانات. تحقق من الاتصال ثم أعد المحاولة.', true);
  }
  function renderAccountControl() {
    const topbar = document.querySelector('.topbar');
    const localBadge = topbar.querySelector('.local');
    let controls = document.getElementById('cloudControls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'cloudControls';
      controls.className = 'cloud-controls';
      topbar.appendChild(controls);
    }
    controls.appendChild(localBadge);
    localBadge.textContent = localPreview ? 'معاينة محلية · عرض فقط' : user ? 'وضع التعديل مفعّل' : 'متاح للعرض · الدخول للتعديل';
    let button = document.getElementById('cloudAccountButton');
    if (!button) {
      button = document.createElement('button');
      button.id = 'cloudAccountButton';
      button.className = 'button soft small-btn';
      controls.appendChild(button);
    }
    button.textContent = user ? 'تسجيل الخروج' : 'دخول للتعديل';
    button.hidden = localPreview;
    button.onclick = () => {
      if (!client) { showLogin(); return; }
      user ? client.auth.signOut() : showLogin();
    };
    let backupButton = document.getElementById('cloudBackupButton');
    if (!backupButton) {
      backupButton = document.createElement('button');
      backupButton.id = 'cloudBackupButton';
      backupButton.className = 'button soft small-btn';
      backupButton.type = 'button';
      backupButton.textContent = 'تنزيل نسخة احتياطية';
      controls.appendChild(backupButton);
    }
    backupButton.hidden = localPreview || !user;
    backupButton.onclick = () => downloadBackup(backupButton);
  }
  async function downloadBackup(button) {
    if (!user || !client) return;
    button.disabled = true;
    try {
      await queueEmployeeSave();
      const holidayTask = syncQueue.then(() => syncTable('holidays', holidays, holidayBaseline, holidayRow));
      syncQueue = holidayTask.catch(err => console.error('Manawib backup sync failed', err));
      await holidayTask;

      const [directoryResult, privateResult, holidayResult] = await Promise.all([
        client.from('employees').select('id,name').order('name'),
        client.from('employee_private').select('id,number,phone,start_date,leave_balance,leave_used,credit_years,accrual_anchor,has_access_code').order('id'),
        client.from('holidays').select('*').order('start_date')
      ]);
      for (const result of [directoryResult, privateResult, holidayResult]) {
        if (result.error) throw result.error;
      }
      const privateById = new Map(privateResult.data.map(row => [row.id, row]));
      const payload = {
        format: 'manawib-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        employees: directoryResult.data.map(row => {
          const details = privateById.get(row.id);
          return details
            ? { ...employeeFromPrivateRow(details, row.name, details.has_access_code) }
            : { id:row.id, name:row.name };
        }),
        holidays: holidayResult.data.map(holidayFromRow)
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'manawib-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast('تم تنزيل النسخة الاحتياطية من قاعدة البيانات');
    } catch (error) {
      console.error('Manawib backup failed', error);
      toast('تعذر إنشاء النسخة الاحتياطية. لم يتم تنزيل ملف ناقص.');
    } finally {
      button.disabled = false;
    }
  }
  function resumePendingAction() {
    const action = pendingAction;
    pendingAction = null;
    if (action) queueMicrotask(action);
  }
  function startApp() {
    window.MANAWIB_DIRECTORY_MODE = !user;
    window.MANAWIB_IS_EDITOR = !!user;
    document.body.classList.toggle('directory-mode', !user);
    document.querySelector('.shell').style.display = '';
    gate.hidden = true;
    renderAccountControl();
    render();
    updateAccessCodeButton();
    document.title = 'مناوب | إدارة الموظفين والشفتات';
    resumePendingAction();
  }
  function employeeDirectoryRow(e) { return { id:e.id, name:e.name }; }
  function employeePrivateRow(e) {
    return { id:e.id, number:e.number, phone:e.phone||'', start_date:e.startDate,
      leave_balance:Number(e.leaveBalance)||0, leave_used:e.leaveUsed||{}, credit_years:e.creditYears||[],
      accrual_anchor:e.accrualAnchor||null };
  }
  function employeeFromPrivateRow(r, name, hasAccessCode) {
    return { id:r.id, name, number:r.number, phone:r.phone||'', startDate:r.start_date,
      leaveBalance:Number(r.leave_balance)||0, leaveUsed:r.leave_used||{}, creditYears:r.credit_years||[],
      accrualAnchor:r.accrual_anchor||null, hasAccessCode:!!hasAccessCode };
  }
  function clearEmployeePrivateData() {
    for (const e of employees) {
      for (const key of ['number','phone','startDate','leaveBalance','leaveUsed','creditYears','accrualAnchor','hasAccessCode']) delete e[key];
    }
    selectedId = null;
    if (unlockTimer) clearTimeout(unlockTimer);
    unlockTimer = null;
  }
  function lockPublicView() {
    clearEmployeePrivateData();
    document.querySelector('.code-overlay')?.remove();
    render();
  }
  function showCodeDialog(employee, onSubmit) {
    document.querySelector('.code-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'code-overlay';
    overlay.innerHTML = '<section class="code-card" role="dialog" aria-modal="true" aria-labelledby="employeeCodeTitle"><h2 id="employeeCodeTitle">عرض بيانات الموظف</h2><p>أدخل الرمز الخاص بـ <strong>' + esc(employee.name) + '</strong>. لن تظهر بيانات بقية الموظفين.</p><form id="employeeCodeForm"><label for="employeeAccessCode">رمز الموظف</label><input id="employeeAccessCode" type="password" inputmode="text" autocomplete="one-time-code" maxlength="32" required><p id="employeeCodeMessage" class="cloud-error" aria-live="polite"></p><div class="code-actions"><button type="submit" id="employeeCodeSubmit">عرض بياناتي</button><button type="button" class="secondary" id="employeeCodeCancel">إلغاء</button></div></form></section>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#employeeAccessCode');
    overlay.querySelector('#employeeCodeCancel').onclick = () => overlay.remove();
    overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
    overlay.querySelector('#employeeCodeForm').onsubmit = async event => {
      event.preventDefault();
      const button = overlay.querySelector('#employeeCodeSubmit');
      const messageNode = overlay.querySelector('#employeeCodeMessage');
      button.disabled = true;
      messageNode.textContent = 'جارٍ التحقق من الرمز…';
      try { await onSubmit(input.value.trim().toUpperCase()); }
      catch (error) {
        messageNode.textContent = error?.message || 'الرمز غير صحيح. تحقق منه وحاول مرة أخرى.';
        button.disabled = false;
        input.select();
      }
    };
    setTimeout(() => input.focus(), 0);
  }
  async function openEmployeeRecord(id) {
    if (localPreview || !client) return;
    const target = employees.find(e => e.id === id);
    if (!target) return;
    if (selectedId === id && target.number !== undefined) return;
    clearEmployeePrivateData();
    render();
    showCodeDialog(target, async code => {
      const { data, error } = await client.rpc('verify_employee_access_code', {
        p_employee_id:id, p_access_code:code
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) throw new Error('الرمز غير صحيح، أو لم يعيّن الأدمن رمزاً لهذا الموظف بعد.');
      const index = employees.findIndex(e => e.id === id);
      if (index < 0) throw new Error('تعذر العثور على الموظف. حدّث الصفحة وحاول مجدداً.');
      employees[index] = employeeFromPrivateRow(row, target.name, true);
      selectedId = id;
      document.querySelector('.code-overlay')?.remove();
      render();
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        lockPublicView();
        toast('تم إخفاء بيانات الموظف تلقائياً');
      }, 15 * 60 * 1000);
    });
  }
  window.MANAWIB_OPEN_EMPLOYEE = openEmployeeRecord;

  function generateEmployeeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  }
  function showOneTimeCode(employee, code) {
    document.querySelector('.code-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'code-overlay';
    overlay.innerHTML = '<section class="code-card" role="dialog" aria-modal="true"><h2>رمز الدخول الخاص بالموظف</h2><p>أرسل هذا الرمز إلى <strong>' + esc(employee.name) + '</strong>. سيظهر الآن مرة واحدة فقط؛ لا يُحفظ الرمز نفسه في قاعدة البيانات.</p><div class="one-time-code" id="newEmployeeCode">' + esc(code) + '</div><p id="copyCodeMessage" class="cloud-note"></p><div class="code-actions"><button type="button" id="copyEmployeeCode">نسخ الرمز</button><button type="button" class="secondary" id="closeEmployeeCode">تم</button></div></section>';
    document.body.appendChild(overlay);
    overlay.querySelector('#copyEmployeeCode').onclick = async () => {
      const messageNode = overlay.querySelector('#copyCodeMessage');
      try {
        await navigator.clipboard.writeText(code);
        messageNode.textContent = 'تم نسخ الرمز. أرسله للموظف بطريقة آمنة.';
      } catch {
        messageNode.textContent = 'تعذر النسخ تلقائياً؛ حدّد الرمز وانسخه يدوياً.';
      }
    };
    const close = () => overlay.remove();
    overlay.querySelector('#closeEmployeeCode').onclick = close;
    overlay.onclick = event => { if (event.target === overlay) close(); };
  }
  async function issueEmployeeCode(employee) {
    if (!user || !employee?.id) return;
    const code = generateEmployeeCode();
    const { error } = await client.rpc('set_employee_access_code', {
      p_employee_id:employee.id, p_access_code:code
    });
    if (error) {
      toast('تعذر تعيين الرمز. تأكد من تطبيق تحديث قاعدة البيانات ثم أعد المحاولة.');
      console.error('Could not set employee access code', error);
      return;
    }
    employee.hasAccessCode = true;
    updateAccessCodeButton();
    showOneTimeCode(employee, code);
  }
  window.MANAWIB_AFTER_EMPLOYEE_SAVE = async (employee, isNew) => {
    if (user && isNew) await issueEmployeeCode(employee);
  };
  function updateAccessCodeButton() {
    const actions = document.querySelector('#detail .profile .actions');
    const employee = employees.find(e => e.id === selectedId);
    const old = document.getElementById('issueCodeBtn');
    if (!user || !actions || !employee) { old?.remove(); return; }
    const button = old || document.createElement('button');
    button.id = 'issueCodeBtn';
    button.className = 'button soft small-btn';
    button.type = 'button';
    const label = employee.hasAccessCode ? 'إعادة تعيين رمز الدخول' : 'تعيين رمز الدخول';
    // This button is inside the observed #detail subtree. Avoid replacing its
    // text node on every observer callback, which would trigger an endless loop.
    if (button.textContent !== label) button.textContent = label;
    button.onclick = () => issueEmployeeCode(employee);
    if (!old) actions.appendChild(button);
  }
  new MutationObserver(updateAccessCodeButton).observe(document.getElementById('detail'), {childList:true,subtree:true});
  document.addEventListener('visibilitychange', () => {
    if (user || !selectedId) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(lockPublicView, 5 * 60 * 1000);
    } else if (hiddenAt) {
      const hiddenFor = Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenFor >= 5 * 60 * 1000) lockPublicView();
      else {
        clearTimeout(unlockTimer);
        unlockTimer = setTimeout(() => {
          lockPublicView();
          toast('تم إخفاء بيانات الموظف تلقائياً');
        }, 15 * 60 * 1000);
      }
    }
  });
  function holidayRow(h) { return { id:h.id, name:h.name, start_date:h.start, end_date:h.end, source:h.source||'' }; }
  function holidayFromRow(r) { return { id:r.id, name:r.name, start:r.start_date, end:r.end_date, source:r.source||'' }; }

  async function syncTable(table, current, baseline, toRow) {
    const currentMap = new Map(current.map(item => [item.id, item]));
    const changed = [];
    for (const item of current) {
      const row = toRow(item), before = baseline.get(item.id);
      if (!before || JSON.stringify(row) !== JSON.stringify(before)) changed.push(row);
    }
    const removed = [...baseline.keys()].filter(id => !currentMap.has(id));
    if (changed.length) {
      const { error } = await client.from(table).upsert(changed, { onConflict:'id' });
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await client.from(table).delete().in('id', removed);
      if (error) throw error;
    }
    baseline.clear();
    current.forEach(item => baseline.set(item.id, toRow(item)));
  }
  function queueEmployeeSave() {
    const task = syncQueue.then(async () => {
      await syncTable('employees', employees, employeeBaseline, employeeDirectoryRow);
      await syncTable('employee_private', employees, privateBaseline, employeePrivateRow);
    });
    syncQueue = task.catch(err => {
      console.error('Manawib cloud sync failed', err);
      toast('تعذر حفظ التغيير. تحقق من صلاحية الحساب والاتصال ثم أعد المحاولة.');
    });
    return task;
  }
  save = function () {
    // Public unlocks are memory-only. Employee records are never written to localStorage.
    if (!user) return Promise.resolve();
    return queueEmployeeSave().catch(() => undefined);
  };
  window.MANAWIB_SAVE_EMPLOYEES_STRICT = queueEmployeeSave;
  saveHolidays = function () {
    if (!user) return Promise.resolve();
    const task = syncQueue.then(() => syncTable('holidays', holidays, holidayBaseline, holidayRow));
    syncQueue = task.catch(err => {
      console.error('Manawib holiday sync failed', err);
      toast('تعذر حفظ العطلة. تحقق من الاتصال والصلاحية.');
    });
    return task.catch(() => undefined);
  };

  async function loadCloud(importLocal) {
    message('جارٍ تحميل بيانات الفريق…');
    const [employeeResult, holidayResult] = await withTimeout(Promise.all([
      client.from('employees').select('id,name').order('name'),
      client.from('holidays').select('*').order('start_date')
    ]));
    if (employeeResult.error) throw employeeResult.error;
    if (holidayResult.error) throw holidayResult.error;
    const cloudDirectory = employeeResult.data;
    const cloudHolidays = holidayResult.data.map(holidayFromRow);

    if (importLocal) {
      employees = localEmployees.map(e => ({...e}));
      holidays = cloudHolidays.length ? cloudHolidays : localHolidays;
      await syncTable('employees', employees, employeeBaseline, employeeDirectoryRow);
      await syncTable('employee_private', employees, privateBaseline, employeePrivateRow);
      await syncTable('holidays', holidays, holidayBaseline, holidayRow);
    } else {
      if (user) {
        const privateResult = await withTimeout(client.from('employee_private')
          .select('id,number,phone,start_date,leave_balance,leave_used,credit_years,accrual_anchor,has_access_code')
          .order('id'));
        if (privateResult.error) throw privateResult.error;
        const privateById = new Map(privateResult.data.map(r => [r.id, r]));
        employees = cloudDirectory.map(row => {
          const record = privateById.get(row.id);
          return record ? employeeFromPrivateRow(record, row.name, record.has_access_code) : {id:row.id,name:row.name};
        });
        privateBaseline = new Map(employees.filter(e => e.number !== undefined).map(e => [e.id, employeePrivateRow(e)]));
      } else {
        employees = cloudDirectory.map(({id,name}) => ({id,name}));
        privateBaseline.clear();
      }
      holidays = cloudHolidays.length ? cloudHolidays : officialHolidays();
      employeeBaseline = new Map(employees.map(e => [e.id, employeeDirectoryRow(e)]));
      holidayBaseline = new Map(cloudHolidays.map(h => [h.id, holidayRow(h)]));
      if (user && !cloudHolidays.length && holidays.length) {
        await syncTable('holidays', holidays, holidayBaseline, holidayRow);
      }
    }
    selectedId = user ? (employees[0]?.id || null) : null;
    // Drop any stale per-device copy left by an older application release.
    localStorage.removeItem('manawib_employees_v1');
    localStorage.removeItem('manawib_oman_holidays_v1');
    startApp();
  }

  async function loadPublicDirectory() {
    const employeeResult = await withTimeout(
      client.from('employees').select('id,name').order('name')
    );
    if (employeeResult.error) throw employeeResult.error;
    employees = employeeResult.data.map(({id,name}) => ({id,name}));
    selectedId = null;
    privateBaseline.clear();
    employeeBaseline = new Map(employees.map(e => [e.id, employeeDirectoryRow(e)]));
    if (!holidays?.length) holidays = officialHolidays();
    savePublicCache();
    startApp();

    try {
      const holidayResult = await withTimeout(
        client.from('holidays').select('*').order('start_date')
      );
      if (holidayResult.error) throw holidayResult.error;
      const cloudHolidays = holidayResult.data.map(holidayFromRow);
      holidays = cloudHolidays.length ? cloudHolidays : officialHolidays();
      holidayBaseline = new Map(cloudHolidays.map(h => [h.id, holidayRow(h)]));
      savePublicCache();
      renderDetail();
    } catch (error) {
      console.warn('Manawib holiday refresh failed', error);
    }
  }

  function showImportChoice() {
    show('<h1>قاعدة الفريق جاهزة</h1><p>وجدت بيانات محفوظة على هذا الجهاز. اختر هل تنقلها إلى قاعدة الفريق المشتركة أم تبدأ بقاعدة فارغة. لن تُرفع البيانات إلا بعد اختيارك.</p><p id="cloudMessage" class="cloud-note"></p><div class="cloud-actions"><button id="importLocal">نقل بيانات هذا الجهاز إلى الفريق</button><button class="secondary" id="startEmpty">ابدأ بقاعدة فارغة</button></div>');
    document.getElementById('importLocal').onclick = () => loadCloud(true).catch(e => message(e.message, true));
    document.getElementById('startEmpty').onclick = () => loadCloud(false).catch(e => message(e.message, true));
  }
  async function prepareEditor(session) {
    user = session.user;
    try {
      const { data: allowed, error: permissionError } = await withTimeout(client.rpc('can_edit_manawib'));
      if (permissionError) throw permissionError;
      if (!allowed) {
        user = null;
        await client.auth.signOut();
        renderAccountControl();
        showLogin('هذا الحساب غير مصرح له بالتعديل. اطلب من المسؤول إضافته.');
        return;
      }
      const { data, error } = await withTimeout(client.from('employees').select('id').limit(1));
      if (error) throw error;
      if (!data.length && localEmployees.length) { showImportChoice(); return; }
      await loadCloud(false);
    } catch (e) {
      user = null;
      renderAccountControl();
      showLogin(e.message || 'تعذر التحقق من صلاحية التعديل.');
    }
  }
  function showLogin(errorText) {
    if (!client) {
      showPublicError('تعذر تحميل الاتصال بقاعدة البيانات. تحقق من الإنترنت ثم أعد تحميل الصفحة.');
      return;
    }
    const returnButton = document.querySelector('.shell').style.display !== 'none'
      ? '<button type="button" class="secondary" id="returnToView">العودة للعرض</button>' : '';
    show('<h1>دخول الأدمن للتعديل</h1><p>الأسماء ظاهرة للجميع. بيانات الموظف تظهر له بعد إدخال رمزه الخاص، وإدارة بيانات الفريق والرموز متاحة للأدمن المعتمد فقط.</p><form id="cloudLogin"><label for="cloudEmail">البريد الإلكتروني</label><input id="cloudEmail" type="email" autocomplete="username" required><label for="cloudPassword">كلمة المرور</label><input id="cloudPassword" type="password" autocomplete="new-password" minlength="6" required><p id="cloudMessage" class="cloud-error"></p><div class="cloud-actions"><button id="cloudLoginButton" type="submit">دخول</button><button id="cloudSignUpButton" class="secondary" type="button">إنشاء حساب</button>'+returnButton+'</div></form>');
    const back = document.getElementById('returnToView');
    if (back) back.onclick = () => { gate.hidden = true; };
    document.getElementById('cloudSignUpButton').onclick = async () => {
      const button = document.getElementById('cloudSignUpButton');
      const email = document.getElementById('cloudEmail').value.trim();
      const password = document.getElementById('cloudPassword').value;
      if (!email || password.length < 6) {
        message('أدخل البريد وكلمة مرور من 6 أحرف على الأقل.', true);
        return;
      }
      button.disabled = true;
      message('جارٍ إنشاء الحساب…');
      try {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user?.identities?.length === 0) {
          message('قد يكون لهذا البريد حساب مسبقاً. جرّب تسجيل الدخول.', true);
        } else if (data.session?.user) {
          await prepareEditor(data.session);
          return;
        } else {
          message('تم إنشاء الحساب. أكّد بريدك من رسالة Supabase، ثم سجّل الدخول.', false);
        }
      } catch (e) {
        message('تعذر إنشاء الحساب. تحقق من البريد وكلمة المرور ثم حاول مجدداً.', true);
      } finally {
        button.disabled = false;
      }
    };

    document.getElementById('cloudLogin').onsubmit = async event => {
      event.preventDefault();
      const button = document.getElementById('cloudLoginButton');
      button.disabled = true;
      message('جارٍ التحقق من الحساب…');
      const { data, error } = await client.auth.signInWithPassword({
        email:document.getElementById('cloudEmail').value.trim(),
        password:document.getElementById('cloudPassword').value
      });
      if (error) {
        button.disabled = false;
        message('تعذر الدخول. تأكد من البريد وكلمة المرور أو اطلب حساباً مصرحاً به.', true);
        return;
      }
      await prepareEditor(data.session);
    };
    const emailInput = document.getElementById('cloudEmail');
    if (emailInput) emailInput.focus();
    if (errorText) message(errorText, true);
  }

  const protectedButtons = 'button#addBtn,button#quickAdd,button#emptyAdd,button#editBtn,button#deleteBtn,button#useLeave,button#undoLeave,button#holidayManagerBtn,button[data-delete-holiday]';
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest(protectedButtons) : null;
    if (!button || user) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!client) { showLogin(); return; }
    pendingAction = () => button.click();
    showLogin();
  }, true);
  document.addEventListener('submit', event => {
    if (user || !['employeeForm','holidayForm'].includes(event.target.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.target;
    pendingAction = () => form.requestSubmit();
    showLogin();
  }, true);

  async function boot() {
    if (localPreview) {
      startApp();
      return;
    }
    if (!url.startsWith('https://') || !key || key.includes('PASTE_')) {
      showPublicError('تعذر الاتصال بمصدر بيانات الفريق.');
      return;
    }
    if (!window.supabase?.createClient) {
      showPublicError('تعذر تحميل خدمة قاعدة البيانات.');
      return;
    }
    client = window.supabase.createClient(url, key, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        user = null;
        window.MANAWIB_DIRECTORY_MODE = true;
        window.MANAWIB_IS_EDITOR = false;
        clearEmployeePrivateData();
        employeeBaseline.clear();
        privateBaseline.clear();
        localStorage.removeItem('manawib_employees_v1');
        document.getElementById('modalBack')?.classList.remove('show');
        document.getElementById('holidayModal')?.classList.remove('show');
        document.querySelector('.code-overlay')?.remove();
        renderAccountControl();
        render();
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        user = session.user;
      }
    });
    startApp();
    const { data:{session}, error } = await withTimeout(client.auth.getSession());
    if (error) throw error;
    if (session?.user && !session.user.is_anonymous) {
      await prepareEditor(session);
      return;
    }
    if (session?.user?.is_anonymous) await client.auth.signOut();
    const cache = readPublicCache();
    if (cache) {
      employees = cache.employees;
      holidays = cache.holidays;
      selectedId = null;
      startApp();
    }
    try {
      await loadPublicDirectory();
    } catch (e) {
      if (cache) showConnectionStatus(e.message || 'تعذر تحديث القائمة المحفوظة.', true);
      else showPublicError(e.message || 'تعذر تحديث البيانات.');
    }
  }
  boot().catch(e => {
    showPublicError(e.message || 'تعذر تحديث البيانات. تحقق من الاتصال ثم أعد المحاولة.');
  });
  // Add email recovery and reset flows to the public login screen.
  function appRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }
  function showRecoveryRequest() {
    show('<h1>استعادة كلمة المرور</h1><p>أدخل بريد حسابك وسنرسل لك رابطاً لاختيار كلمة مرور جديدة.</p><form id="recoveryRequest"><label for="recoveryEmail">البريد الإلكتروني</label><input id="recoveryEmail" type="email" autocomplete="email" required><p id="cloudMessage" class="cloud-note"></p><div class="cloud-actions"><button id="recoverySend" type="submit">إرسال رابط الاستعادة</button><button id="recoveryBack" type="button" class="secondary">العودة للدخول</button></div></form>');
    document.getElementById('recoveryBack').onclick = () => showLogin();
    document.getElementById('recoveryRequest').onsubmit = async event => {
      event.preventDefault();
      const button = document.getElementById('recoverySend');
      button.disabled = true;
      const email = document.getElementById('recoveryEmail').value.trim();
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appRedirectUrl() });
      button.disabled = false;
      if (error) message('تعذر إرسال الرابط. تحقق من البريد وحاول مرة أخرى.', true);
      else message('إذا كان البريد مسجلاً، ستصلك رسالة استعادة. افتحها من هذا المتصفح.', false);
    };
  }
  function showPasswordUpdate() {
    show('<h1>تعيين كلمة مرور جديدة</h1><p>اختر كلمة مرور من 6 أحرف على الأقل.</p><form id="passwordUpdate"><label for="newCloudPassword">كلمة المرور الجديدة</label><input id="newCloudPassword" type="password" autocomplete="new-password" minlength="6" required><p id="cloudMessage" class="cloud-error"></p><div class="cloud-actions"><button id="passwordUpdateButton" type="submit">حفظ كلمة المرور</button></div></form>');
    document.getElementById('passwordUpdate').onsubmit = async event => {
      event.preventDefault();
      const button = document.getElementById('passwordUpdateButton');
      button.disabled = true;
      const password = document.getElementById('newCloudPassword').value;
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        button.disabled = false;
        message('تعذر تغيير كلمة المرور. أعد طلب رابط استعادة جديد.', true);
        return;
      }
      history.replaceState(null, document.title, appRedirectUrl());
      message('تم تغيير كلمة المرور. جارٍ فتح مناوب…', false);
      setTimeout(() => window.location.reload(), 700);
    };
  }
  const authReturn = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const returnedAuthType = authReturn.get('type');
  const returnedAuthError = authReturn.get('error_description');
  let callbackHandled = false;
  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || returnedAuthType === 'recovery') && session?.user && !callbackHandled) {
        callbackHandled = true;
        queueMicrotask(showPasswordUpdate);
      } else if (event === 'SIGNED_IN' && session?.user && ['signup','email'].includes(returnedAuthType) && !callbackHandled) {
        callbackHandled = true;
        setTimeout(() => {
          history.replaceState(null, document.title, appRedirectUrl());
          window.location.reload();
        }, 0);
      }
    });
    if (returnedAuthType === 'recovery') {
      client.auth.getSession().then(({ data }) => {
        if (data.session && !callbackHandled) {
          callbackHandled = true;
          showPasswordUpdate();
        } else if (!data.session) showLogin('انتهت صلاحية رابط الاستعادة. اطلب رابطاً جديداً.');
      });
    }
    if (returnedAuthError) {
      setTimeout(() => {
        history.replaceState(null, document.title, appRedirectUrl());
        showLogin('تعذر تأكيد البريد. قد يكون الرابط منتهي الصلاحية أو استُخدم من قبل. أعد إرسال رابط التأكيد.');
      }, 1200);
    }
    const addRecoveryButtons = () => {
      const actions = document.querySelector('#cloudLogin .cloud-actions');
      if (!actions || document.getElementById('cloudForgotPassword')) return;
      const forgot = document.createElement('button');
      forgot.type = 'button';
      forgot.id = 'cloudForgotPassword';
      forgot.className = 'secondary';
      forgot.textContent = 'نسيت كلمة المرور؟';
      forgot.onclick = showRecoveryRequest;
      actions.appendChild(forgot);
      const resend = document.createElement('button');
      resend.type = 'button';
      resend.id = 'cloudResendConfirmation';
      resend.className = 'secondary';
      resend.textContent = 'إعادة إرسال تأكيد البريد';
      resend.onclick = async () => {
        const email = document.getElementById('cloudEmail')?.value.trim();
        if (!email) { message('أدخل بريدك أولاً.', true); return; }
        const { error } = await client.auth.resend({ type:'signup', email, options:{ emailRedirectTo:appRedirectUrl() } });
        if (error) message('تعذر إرسال رسالة التأكيد. انتظر قليلاً ثم حاول مرة أخرى.', true);
        else message('أرسلنا رابط تأكيد جديد. استخدم أحدث رسالة وصلتك.', false);
      };
      actions.appendChild(resend);
    };
    new MutationObserver(addRecoveryButtons).observe(document.body, { childList:true, subtree:true });
    addRecoveryButtons();
  }
})();
