/* Public read access with authenticated, allowlisted editing for Manawib. */
(function () {
  'use strict';

  const url = window.MANAWIB_SUPABASE_URL || '';
  const key = window.MANAWIB_SUPABASE_KEY || '';
  const localEmployees = JSON.parse(JSON.stringify(employees));
  const localHolidays = JSON.parse(JSON.stringify(holidays));
  const oldSave = save;
  const oldSaveHolidays = saveHolidays;
  let client, user = null;
  let employeeBaseline = new Map(), holidayBaseline = new Map();
  let syncQueue = Promise.resolve();
  let pendingAction = null;

  const style = document.createElement('style');
  style.textContent = '.cloud-gate{position:fixed;inset:0;z-index:20;background:#f5f7f4ed;display:grid;place-items:center;padding:18px;direction:rtl;font-family:Tahoma,Arial,sans-serif;color:#20312d}.cloud-card{width:min(460px,100%);background:#fff;border:1px solid #e5ebe7;border-radius:18px;padding:24px;box-shadow:0 12px 36px #253c3010}.cloud-card h1{font-size:21px;margin:0 0 8px}.cloud-card p{font-size:14px;line-height:1.8;color:#71817b}.cloud-card label{display:block;font-size:13px;margin:12px 0 5px}.cloud-card input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #dce4de;border-radius:9px;font:inherit}.cloud-card button{border:0;border-radius:9px;padding:11px 15px;background:#16795b;color:white;font:inherit;cursor:pointer;margin-top:14px}.cloud-card button.secondary{background:#e9f4ee;color:#16795b;margin-right:6px}.cloud-card button:disabled{opacity:.55;cursor:wait}.cloud-error{color:#aa3936!important}.cloud-note{font-size:12px!important}.cloud-actions{display:flex;flex-wrap:wrap;gap:6px}.cloud-gate[hidden]{display:none}.cloud-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cloud-controls .button{white-space:nowrap}';
  document.head.appendChild(style);
  document.querySelector('.shell').style.display = 'none';
  const gate = document.createElement('main');
  gate.className = 'cloud-gate';
  document.body.appendChild(gate);

  function show(html) { gate.innerHTML = '<section class="cloud-card">' + html + '</section>'; gate.hidden = false; }
  function message(text, error) {
    const el = document.getElementById('cloudMessage');
    if (el) { el.textContent = text; el.className = error ? 'cloud-error' : 'cloud-note'; }
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
    localBadge.textContent = user ? 'وضع التعديل مفعّل' : 'متاح للعرض · الدخول للتعديل';
    let button = document.getElementById('cloudAccountButton');
    if (!button) {
      button = document.createElement('button');
      button.id = 'cloudAccountButton';
      button.className = 'button soft small-btn';
      controls.appendChild(button);
    }
    button.textContent = user ? 'تسجيل الخروج' : 'دخول للتعديل';
    button.onclick = () => user ? client.auth.signOut() : showLogin();
  }
  function resumePendingAction() {
    const action = pendingAction;
    pendingAction = null;
    if (action) queueMicrotask(action);
  }
  function startApp() {
    document.querySelector('.shell').style.display = '';
    gate.hidden = true;
    renderAccountControl();
    render();
    renderDetail();
    document.title = 'مناوب | إدارة الموظفين والشفتات';
    resumePendingAction();
  }
  function employeeRow(e) {
    return { id:e.id, name:e.name, number:e.number, phone:e.phone||'', start_date:e.startDate,
      leave_balance:Number(e.leaveBalance)||0, leave_used:e.leaveUsed||{}, credit_years:e.creditYears||[],
      accrual_anchor:e.accrualAnchor||null };
  }
  function employeeFromRow(r) {
    return { id:r.id, name:r.name, number:r.number, phone:r.phone||'', startDate:r.start_date,
      leaveBalance:Number(r.leave_balance)||0, leaveUsed:r.leave_used||{}, creditYears:r.credit_years||[],
      accrualAnchor:r.accrual_anchor||null };
  }
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
  function queueSync(table, items, baseline, toRow) {
    syncQueue = syncQueue.then(() => syncTable(table, items, baseline, toRow)).catch(err => {
      console.error('Manawib cloud sync failed', err);
      toast('تعذر حفظ التغيير. تحقق من صلاحية الحساب والاتصال ثم أعد المحاولة.');
    });
  }
  save = function () {
    oldSave();
    if (user) queueSync('employees', employees, employeeBaseline, employeeRow);
  };
  saveHolidays = function () {
    oldSaveHolidays();
    if (user) queueSync('holidays', holidays, holidayBaseline, holidayRow);
  };

  async function loadCloud(importLocal) {
    message('جارٍ تحميل بيانات الفريق…');
    const [employeeResult, holidayResult] = await Promise.all([
      client.from('employees').select('*').order('name'),
      client.from('holidays').select('*').order('start_date')
    ]);
    if (employeeResult.error) throw employeeResult.error;
    if (holidayResult.error) throw holidayResult.error;
    const cloudEmployees = employeeResult.data.map(employeeFromRow);
    const cloudHolidays = holidayResult.data.map(holidayFromRow);

    if (importLocal) {
      employees = localEmployees;
      holidays = cloudHolidays.length ? cloudHolidays : localHolidays;
      await Promise.all([
        syncTable('employees', employees, employeeBaseline, employeeRow),
        syncTable('holidays', holidays, holidayBaseline, holidayRow)
      ]);
    } else {
      employees = cloudEmployees;
      holidays = cloudHolidays.length ? cloudHolidays : officialHolidays();
      employeeBaseline = new Map(employees.map(e => [e.id, employeeRow(e)]));
      holidayBaseline = new Map(cloudHolidays.map(h => [h.id, holidayRow(h)]));
      if (user && !cloudHolidays.length && holidays.length) {
        await syncTable('holidays', holidays, holidayBaseline, holidayRow);
      }
    }
    selectedId = employees[0]?.id || null;
    oldSave(); oldSaveHolidays();
    startApp();
  }

  function showImportChoice() {
    show('<h1>قاعدة الفريق جاهزة</h1><p>وجدت بيانات محفوظة على هذا الجهاز. اختر هل تنقلها إلى قاعدة الفريق المشتركة أم تبدأ بقاعدة فارغة. لن تُرفع البيانات إلا بعد اختيارك.</p><p id="cloudMessage" class="cloud-note"></p><div class="cloud-actions"><button id="importLocal">نقل بيانات هذا الجهاز إلى الفريق</button><button class="secondary" id="startEmpty">ابدأ بقاعدة فارغة</button></div>');
    document.getElementById('importLocal').onclick = () => loadCloud(true).catch(e => message(e.message, true));
    document.getElementById('startEmpty').onclick = () => loadCloud(false).catch(e => message(e.message, true));
  }
  async function prepareEditor(session) {
    user = session.user;
    try {
      const { data: allowed, error: permissionError } = await client.rpc('can_edit_manawib');
      if (permissionError) throw permissionError;
      if (!allowed) {
        user = null;
        await client.auth.signOut();
        renderAccountControl();
        showLogin('هذا الحساب غير مصرح له بالتعديل. اطلب من المسؤول إضافته.');
        return;
      }
      const { data, error } = await client.from('employees').select('id').limit(1);
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
    const returnButton = document.querySelector('.shell').style.display !== 'none'
      ? '<button type="button" class="secondary" id="returnToView">العودة للعرض</button>' : '';
    show('<h1>دخول للتعديل</h1><p>عرض الأسماء والجداول متاح للجميع. أدخل حساباً مصرحاً له للإضافة أو التعديل.</p><form id="cloudLogin"><label for="cloudEmail">البريد الإلكتروني</label><input id="cloudEmail" type="email" autocomplete="username" required><label for="cloudPassword">كلمة المرور</label><input id="cloudPassword" type="password" autocomplete="current-password" required><p id="cloudMessage" class="cloud-error"></p><div class="cloud-actions"><button id="cloudLoginButton" type="submit">دخول</button>'+returnButton+'</div></form>');
    const back = document.getElementById('returnToView');
    if (back) back.onclick = () => { gate.hidden = true; };
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
    if (!url.startsWith('https://') || !key || key.includes('PASTE_')) {
      show('<h1>قاعدة الفريق لم تُربط بعد</h1><p id="cloudMessage" class="cloud-error">تعذر العثور على إعدادات Supabase.</p>');
      return;
    }
    if (!window.supabase?.createClient) {
      show('<h1>تعذر تحميل خدمة قاعدة البيانات</h1><p id="cloudMessage" class="cloud-error">تحقق من اتصال الإنترنت ثم حدّث الصفحة.</p>');
      return;
    }
    client = window.supabase.createClient(url, key, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        user = null;
        document.getElementById('modalBack')?.classList.remove('show');
        document.getElementById('holidayModal')?.classList.remove('show');
        renderAccountControl();
        render();
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        user = session.user;
      }
    });
    const { data:{session}, error } = await client.auth.getSession();
    if (error) throw error;
    if (session?.user && !session.user.is_anonymous) {
      await prepareEditor(session);
      return;
    }
    if (session?.user?.is_anonymous) await client.auth.signOut();
    try {
      await loadCloud(false);
    } catch (e) {
      show('<h1>تعذر تحميل البيانات العامة</h1><p id="cloudMessage" class="cloud-error"></p><button id="retryPublic">إعادة المحاولة</button>');
      message(e.message || 'تحقق من إعداد القراءة العامة في قاعدة البيانات.', true);
      document.getElementById('retryPublic').onclick = () => boot().catch(err => message(err.message, true));
    }
  }
  boot().catch(e => {
    show('<h1>تعذر الاتصال</h1><p id="cloudMessage" class="cloud-error"></p>');
    message(e.message || 'تحقق من إعداد Supabase.', true);
  });
})();
