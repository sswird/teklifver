const crypto = require('crypto');
const { baseUrl } = require('./url');

const escapeHtml = text =>
  String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const absolute = url => (url.startsWith('http') ? url : baseUrl() + url);

// Logo sitenin kendi adresinden yüklenir; başka bir sunucunun adresi gömülmez.
const logoUrl = () => absolute('/apple-touch-icon.png');
const MAIL_FOOTER = 'TeklifVer · İşini yaz, firmalar yarışsın.';

// Hem düz metin hem HTML üretir; e-posta istemcileri için stiller satır içidir.
function renderMail({ heading, lines, action, footer }) {
  const paragraphs = lines.map(line => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(line)}</p>`).join('');
  const actionUrl = action && absolute(action.url);
  const button = action
    ? `<p style="margin:20px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:11px 22px;background:#c2410c;color:#ffffff;font-weight:bold;text-decoration:none;border-radius:4px;font-size:15px">${escapeHtml(action.label)}</a></p>`
    : '';
  const footerHtml = footer
    ? `<p style="margin:16px 0 0;color:#666;font-size:12px;line-height:1.5">${escapeHtml(footer.text)}${footer.link ? ` <a href="${escapeHtml(absolute(footer.link.url))}" style="color:#0f5bb5">${escapeHtml(footer.link.label)}</a>` : ''}</p>`
    : '';

  return {
    text: [
      heading,
      '',
      ...lines,
      ...(action ? ['', `${action.label}: ${actionUrl}`] : []),
      ...(footer ? ['', footer.text, ...(footer.link ? [`${footer.link.label}: ${absolute(footer.link.url)}`] : [])] : [])
    ].join('\n'),
    html: `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14.5px;color:#222;max-width:560px;margin:0 auto;border:1px solid #d9dde1;border-radius:8px;overflow:hidden;background:#ffffff">
      <div style="padding:16px 20px;background:#0f2650">
        <table cellpadding="0" cellspacing="0" border="0" style="vertical-align:middle">
          <tr>
            <td style="vertical-align:middle;padding-right:12px">
              <img src="${escapeHtml(logoUrl())}" width="38" height="38" style="border-radius:6px;display:block" alt="TeklifVer Logo">
            </td>
            <td style="vertical-align:middle">
              <span style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:-0.5px">teklif<span style="margin-left:4px;padding:2px 8px 3px;background:#c2410c;color:#ffffff;border-radius:3px;font-size:22px">ver</span></span>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding:24px 20px">
        <h1 style="margin:0 0 16px;font-size:18px;color:#0f2650;font-weight:bold">${escapeHtml(heading)}</h1>
        ${paragraphs}${button}${footerHtml}
      </div>
      <div style="padding:12px 20px;background:#f6f7f8;border-top:1px solid #eceef1;text-align:center;color:#777;font-size:12px">
        ${MAIL_FOOTER}
      </div>
    </div>`
  };
}

function verificationCodeMail(code, name) {
  const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    subject: `TeklifVer kodunuz: ${code}`,
    text: `Merhaba ${name || ''},\n\nTeklifVer kodunuz: ${code}\n\nKod 15 dakika geçerli. Kimseyle paylaşmayın; TeklifVer çalışanları da sizden kod istemez.\nBu isteği siz yapmadıysanız e-postayı silebilirsiniz.`,
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:500px;margin:0 auto;border:1px solid #d9dde1;border-radius:8px;overflow:hidden;background:#ffffff;">
        <div style="padding:18px 20px;background:#0f2650;text-align:center;">
          <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto">
            <tr>
              <td style="vertical-align:middle;padding-right:12px">
                <img src="${escapeHtml(logoUrl())}" width="42" height="42" style="border-radius:6px;display:block" alt="TeklifVer Logo">
              </td>
              <td style="vertical-align:middle">
                <span style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:-0.5px">teklif<span style="margin-left:4px;padding:2px 8px 3px;background:#c2410c;color:#ffffff;border-radius:3px;font-size:24px">ver</span></span>
              </td>
            </tr>
          </table>
        </div>
        <div style="padding:24px 16px;text-align:center;">
          <h3 style="margin:0 0 12px;color:#1c1e21;font-size:20px;font-weight:bold;">TeklifVer kodunuz</h3>
          <p style="color:#4a5568;font-size:14.5px;margin:0 0 20px;line-height:1.5;">
            Merhaba <strong>${escapeHtml(name || '')}</strong>, giriş için kodunuz:
          </p>
          <div style="background:#fdeee3;border:2px dashed #f97316;padding:14px 24px;border-radius:8px;display:inline-block;margin-bottom:20px;">
            <span style="font-size:34px;font-weight:bold;letter-spacing:6px;color:#1c1e21;font-family:monospace;">${formattedCode}</span>
          </div>
          <p style="color:#718096;font-size:13px;margin:0;line-height:1.5;">
            Kod <strong>15 dakika</strong> geçerli. Kimseyle paylaşmayın; TeklifVer çalışanları da sizden kod istemez.<br>
            Bu isteği siz yapmadıysanız e-postayı silebilirsiniz.
          </p>
        </div>
        <div style="text-align:center;padding:12px;border-top:1px solid #edf2f7;background:#f6f7f8;color:#777;font-size:12px;">
          ${MAIL_FOOTER}
        </div>
      </div>
    `
  };
}

function verificationMail(token) {
  return {
    subject: 'TeklifVer e-posta doğrulama',
    ...renderMail({
      heading: 'E-posta adresinizi doğrulayın',
      lines: ['Hesabınızı kullanmaya başlamak için aşağıdaki bağlantıyı açın. Bağlantı 24 saat geçerlidir.', 'Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın.'],
      action: { label: 'E-postamı Doğrula', url: `/email/verify/${token}` }
    })
  };
}

function resetMail(link) {
  return {
    subject: 'TeklifVer şifre sıfırlama',
    ...renderMail({
      heading: 'Şifrenizi sıfırlayın',
      lines: ['Şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın. Bağlantı 1 saat geçerlidir.', 'Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın, şifreniz değişmez.'],
      action: { label: 'Şifremi Sıfırla', url: link }
    })
  };
}

function emailChangeNotice(newEmail) {
  return {
    subject: 'TeklifVer e-posta değişikliği isteği',
    ...renderMail({
      heading: 'E-posta değişikliği istendi',
      lines: [`Hesabınızın e-posta adresini ${newEmail} olarak değiştirme isteği alındı. Yeni adres doğrulanınca değişiklik tamamlanır.`, 'Bu isteği siz yapmadıysanız hemen şifrenizi değiştirin.']
    })
  };
}

function passwordChangedMail() {
  return {
    subject: 'TeklifVer şifreniz değiştirildi',
    ...renderMail({
      heading: 'Şifreniz değiştirildi',
      lines: ['Hesabınızın şifresi değiştirildi ve diğer cihazlardaki oturumlar kapatıldı.', 'Bu işlemi siz yapmadıysanız hemen şifremi unuttum bağlantısını kullanın.'],
      action: { label: 'Şifremi Unuttum', url: '/forgot' }
    })
  };
}

const CATEGORY_LABELS = {
  bids: 'teklif bildirimleri',
  messages: 'mesaj bildirimleri',
  matches: 'uygun talep bildirimleri',
  searches: 'kayıtlı arama bildirimleri'
};

const signature = value =>
  crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`unsub:${value}`).digest('base64url').slice(0, 32);

// Giriş yapmadan bildirim kapatmak için imzalı bağlantı
const unsubscribeToken = (userId, category) => `${userId}.${category}.${signature(`${userId}.${category}`)}`;

function readUnsubscribeToken(token) {
  const [userId, category, given] = String(token).split('.');
  if (!userId || !category || !given || !Object.hasOwn(CATEGORY_LABELS, category)) return null;
  const expected = Buffer.from(signature(`${userId}.${category}`));
  const received = Buffer.from(given);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  return { userId, category };
}

function notificationMail(userId, category, text, url) {
  return {
    subject: `TeklifVer: ${text.length > 70 ? `${text.slice(0, 70)}...` : text}`,
    ...renderMail({
      heading: 'Yeni bildiriminiz var',
      lines: [text],
      action: { label: 'Görüntüle', url },
      footer: {
        text: `Bu e-postayı ${CATEGORY_LABELS[category]} açık olduğu için aldınız.`,
        link: { label: 'Bu bildirimleri kapat', url: `/email/unsub/${unsubscribeToken(userId, category)}` }
      }
    })
  };
}

module.exports = {
  CATEGORY_LABELS,
  verificationCodeMail,
  verificationMail,
  resetMail,
  emailChangeNotice,
  passwordChangedMail,
  notificationMail,
  readUnsubscribeToken
};
