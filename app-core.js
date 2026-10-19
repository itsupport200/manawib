// Employee data and storage.
const STORE = 'manawib_employees_v1', ANNUAL = 30;
let employees = load(), selectedId = employees[0]?.id || null, editingId = null;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '[]');
    for (const e of data) {
      e.leaveUsed = e.leaveUsed || {};
      e.leaveBalance = Number.isFinite(e.leaveBalance) ? e.leaveBalance: Math.max(0, ANNUAL - (+e.leaveUsed[yearNow()] || 0));
      e.creditYears = e.creditYears || [yearNow()]
    }
    return data
  }
  catch {
    return []
  }
}

function save() {
  localStorage.setItem(STORE, JSON.stringify(employees))
}

function esc(x = '') {
  return String(x).replace(/[&<>"']/g, c => ( {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }
  [c]))
}

function date(s) {
  return new Date(s + 'T00:00:00')
}

function fmt(d) {
  return new Intl.DateTimeFormat('ar-OM', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
  }).format(d)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function iso(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function initials(n) {
  return (n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('')
}

function yearNow() {
  return new Date().getFullYear()
}
// Public holidays and shift-cycle calculations.
const HOLIDAY_STORE = 'manawib_oman_holidays_v1', GOV = 'https://gov.om/ar/الأحداث-والفعاليات-القادمة?entity=1004875';
let holidays = loadHolidays();

function loadHolidays() {
  try {
    return JSON.parse(localStorage.getItem(HOLIDAY_STORE)) || officialHolidays()
  }
  catch {
    return officialHolidays()
  }
}

function officialHolidays() {
  return [ {
    id: 'fitr26',
    name: 'إجازة عيد الفطر المبارك',
    start: '2026-03-20',
    end: '2026-03-23',
    source: GOV
  },
  {
    id: 'adha26',
    name: 'إجازة عيد الأضحى المبارك',
    start: '2026-05-26',
    end: '2026-05-29',
    source: 'https://www.moh.gov.om/media/yebbxre3/cirno54-of-2026-regarding-special-duty-timing-during-the-eid-al-adha-holiday-1447ah.pdf'
  },
  {
    id: 'hijri26',
    name: 'إجازة رأس السنة الهجرية',
    start: '2026-06-18',
    end: '2026-06-18',
    source: GOV
  },
  {
    id: 'mawlid26',
    name: 'إجازة المولد النبوي الشريف',
    start: '2026-08-27',
    end: '2026-08-27',
    source: GOV
  },
  {
    id: 'national26',
    name: 'إجازة اليوم الوطني',
    start: '2026-11-25',
    end: '2026-11-26',
    source: GOV
  }]
}

function saveHolidays() {
  localStorage.setItem(HOLIDAY_STORE, JSON.stringify(holidays))
}

function hitHolidays(s) {
  return holidays.filter(h => h.start <= iso(s.end) && h.end >= iso(s.start))
}

function cycle(e) {
  const start = date(e.startDate), today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - start)/86400000), phase = ((days%28) + 28)%28;
  return phase < 14 ? 'on': 'off'
}

function used(e, y = yearNow()) {
  return + (e.leaveUsed?.[y] || 0)
}

function remaining(e) {
  return Math.max(0, +e.leaveBalance || 0)
}

// Dashboard and employee details.
function render() {
  const term = document.getElementById('search').value.trim().toLowerCase(), filtered = employees.filter(e => (e.name + ' ' + e.number + ' ' + (e.phone || '')).toLowerCase().includes(term));
  document.getElementById('employees').innerHTML = filtered.length ? filtered.map(e => `<button class="employee ${e.id===selectedId?'active':''}" data-id="${e.id}"><span class="avatar">${esc(initials(e.name))}</span><span class="emp-main"><strong>${esc(e.name)}</strong><small>الرقم الوظيفي: ${esc(e.number)}</small></span><span class="leave-count">${remaining(e)} يوم</span></button>`).join(''): '<div class="empty-list">لا يوجد موظفون مطابقون. أضف موظفاً للبدء.</div>';
  document.querySelectorAll('.employee').forEach(b => b.onclick = () => {
    selectedId = b.dataset.id;
    render()
  });
  let on = employees.filter(e => cycle(e) === 'on').length;
  document.getElementById('statEmployees').textContent = employees.length;
  document.getElementById('statOn').textContent = on;
  document.getElementById('statOff').textContent = employees.length - on;
  const focus = employees.find(e => e.id === selectedId);
  document.getElementById('statLeave').textContent = focus ? remaining(focus): 0;
  document.querySelector('.stats .stat:last-child .hint').textContent = focus ? 'رصيد ' + focus.name: 'اختر موظفاً لعرض رصيده الفردي';
  renderDetail()
}

// Build the employee shift calendar.
function shifts(e, y) {
  const anchor = date(e.startDate), begin = new Date(y, 0, 1), finish = new Date(y + 1, 0, 1), arr = [];
  let k = Math.floor((begin - anchor)/86400000/28);
  for (let s = new Date(anchor.getTime() + k*28*86400000);
  s < finish;
  s = new Date(+s + 28*86400000)) {
    let end = new Date(+s + 13*86400000);
    if (new Date(+s + 27*86400000) >= begin)arr.push( {
      start: s, end, now: new Date() >= s && new Date(+s + 14*86400000) > new Date()
    })
  }
  return arr
}

function renderDetail() {
  const host = document.getElementById('detail'), e = employees.find(x => x.id === selectedId);
  if (!e) {
    host.innerHTML = '<div class="empty"><div class="icon">👥</div><h3>ابدأ بإضافة موظفيك</h3><p>أدخل اسم الموظف ورقمه وتاريخ بداية شفته القادم لعرض جدول دوامه.</p><button class="button primary" id="emptyAdd">＋ إضافة أول موظف</button></div>';
    document.getElementById('emptyAdd').onclick = () => openModal();
    return
  }
  const y = +(window.displayYear || yearNow()), r = remaining(e), u = used(e), arr = shifts(e, y);
  host.innerHTML = `<div class="detail-content"><div class="profile"><div class="profile-left"><span class="avatar big">${esc(initials(e.name))}</span><div><h2>${esc(e.name)}</h2><p>الرقم الوظيفي: ${esc(e.number)}${e.phone?'　·　'+esc(e.phone):''}</p></div></div><div class="actions"><button class="button ghost small-btn" id="editBtn">✎ تعديل</button><button class="button danger small-btn" id="deleteBtn">حذف</button></div></div><div class="metrics"><div class="metric"><span>حالة الشفت اليوم</span><strong style="color:${cycle(e)==='on'?'var(--green)':'var(--orange)'}">${cycle(e)==='on'?'على رأس العمل':'إجازة'}</strong></div><div class="metric"><span>بداية الشفت القادم</span><strong style="font-size:16px">${fmt(nextStart(e))}</strong><em>06:00 ص</em></div><div class="metric"><span>نظام المناوبة</span><strong>14 / 14</strong><em>يوم</em></div></div><div class="section"><div class="section-title"><h3>الإجازة السنوية المدفوعة</h3><small>السنة ${yearNow()}</small></div><div class="leave-box"><div><div class="leave-text">${u} مستخدم من أصل ${ANNUAL} يوم</div><div class="leave-bar"><i style="width:${Math.min(100,u/ANNUAL*100)}%"></i></div></div><div style="text-align:left"><div class="leave-count">${r} يوم</div><div class="leave-text">متبقٍ</div></div></div><div style="display:flex;gap:8px;margin-top:9px"><button class="button soft small-btn" id="useLeave">＋ تسجيل إجازة مستخدمة</button><button class="button ghost small-btn" id="undoLeave" ${u<=0?'disabled':''}>تراجع يوم</button></div></div><div class="section"><div class="section-title"><h3>جدول الشفتات</h3><select class="year-picker" id="yearPicker" aria-label="السنة">${Array.from({length:7},(_,i)=>yearNow()-2+i).map(v=>`<option ${v===y?'selected':''}>${v}</option>`).join('')}</select></div><div class="shift-wrap"><table class="shift-table"><thead><tr><th>#</th><th>بداية الدوام</th><th>نهاية الدوام</th><th>بعد الشفت</th><th>الحالة</th></tr></thead><tbody>${arr.length?arr.map((s,i)=>`<tr class="${s.now?'current':''}"><td>${i+1}</td><td>${fmt(s.start)} · 06:00 ص</td><td>${fmt(s.end)} · 06:00 ص</td><td>14 يوم إجازة</td><td><span class="badge ${s.now?'':'next'}">${s.now?'الشفت الحالي':s.start>new Date()?'قادم':'انتهى'}</span></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--muted)">لا توجد شفتات في هذه السنة.</td></tr>'}</tbody></table><div class="table-note">تبدأ الشفتات الساعة 6:00 صباح السبت، وينتهي آخر يوم دوام الجمعة الساعة 6:00 صباحاً. تبدأ الشفتات التالية كل 28 يوماً. ${date(e.startDate).getDay()!==6?'تنبيه: تاريخ البداية المُدخل ليس يوم سبت.':''}</div></div></div></div>`;
  document.getElementById('yearPicker').onchange = ev => {
    window.displayYear = +ev.target.value;
    renderDetail()
  };
  document.getElementById('editBtn').onclick = () => openModal(e);
  document.getElementById('deleteBtn').onclick = () => {
    if (confirm(`حذف بيانات ${e.name}؟`)) {
      employees = employees.filter(x => x.id !== e.id);
      selectedId = employees[0]?.id || null;
      save();
      render();
      toast('تم حذف الموظف')
    }
  };
  document.getElementById('useLeave').onclick = () => {
    const n = prompt(`كم يوم إجازة سنوية تريد تسجيلها؟ المتبقي: ${r} يوم`);
    if (n === null)return;
    const days = Number(n);
    if (!Number.isInteger(days) || days < 1) {
      toast('أدخل عدداً صحيحاً أكبر من صفر');
      return
    }
    if (days > r) {
      toast(`الرصيد المتبقي ${r} يوم فقط`);
      return
    }
    e.leaveUsed = e.leaveUsed || {};
    e.leaveUsed[yearNow()] = u + days;
    save();
    render();
    toast(`تم تسجيل ${days} يوم إجازة`)
  };
  document.getElementById('undoLeave').onclick = () => {
    e.leaveUsed[yearNow()] = Math.max(0, u - 1);
    save();
    render()
  }
}

function nextStart(e) {
  const a = date(e.startDate), today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - a)/86400000), k = days < 0 ? 0: Math.floor(days/28) + 1;
  return new Date(+a + k*28*86400000)
}

// Employee form and interaction handlers.
function openModal(e) {
  editingId = e?.id || null;
  document.getElementById('modalTitle').textContent = e ? 'تعديل بيانات الموظف': 'إضافة موظف';
  document.getElementById('saveEmployeeBtn').textContent = e ? 'حفظ التعديلات' : 'إضافة الموظف';
  document.getElementById('name').value = e?.name || '';
  document.getElementById('number').value = e?.number || '';
  document.getElementById('phone').value = e?.phone || '';
  document.getElementById('startDate').value = e?.startDate || '';
  document.getElementById('modalBack').classList.add('show');
  setTimeout(() => document.getElementById('name').focus(), 20)
}

function closeModal() {
  document.getElementById('modalBack').classList.remove('show')
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2300)
}
// Bind page events.
document.getElementById('addBtn').onclick = () => openModal();
document.getElementById('quickAdd').onclick = () => openModal();
document.getElementById('emptyAdd').onclick = () => openModal();
document.getElementById('closeModal').onclick = closeModal;
document.getElementById('cancelModal').onclick = closeModal;
document.getElementById('modalBack').onclick = e => {
  if (e.target.id === 'modalBack')closeModal()
};
document.getElementById('search').oninput = render;
document.getElementById('employeeForm').onsubmit = ev => {
  ev.preventDefault();
  const name = document.getElementById('name').value.trim(), number = document.getElementById('number').value.trim(), phone = document.getElementById('phone').value.trim(), startDate = document.getElementById('startDate').value;
  if (employees.some(x => x.number.toLowerCase() === number.toLowerCase() && x.id !== editingId)) {
    toast('الرقم الوظيفي مسجل لموظف آخر');
    return
  }
  if (new Date(startDate + 'T00:00:00').getDay() !== 6 && !confirm('التاريخ المحدد ليس يوم سبت. هل تريد المتابعة؟'))return;
  if (editingId) {
    const x = employees.find(x => x.id === editingId);
    Object.assign(x, {
      name, number, phone, startDate
    })
  }
  else {
    const x = {
      id: crypto.randomUUID(),
      name,
      number,
      phone,
      startDate,
      leaveUsed: {
      }
    };
    employees.unshift(x);
    selectedId = x.id
  }
  save();
  closeModal();
  render();
  toast(editingId ? 'تم تحديث البيانات': 'تمت إضافة الموظف')
};
render();
