<#-- The frame of every HTML email, matching the Vendure emails; the texts stay Keycloak's -->
<#macro emailLayout>
<!DOCTYPE html>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  .content p { margin: 0 0 14px; }
  .content a { color: #000000; font-weight: 600; }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f2f2f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f2f2;font-family:Inter,Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center" style="padding:24px 12px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:2px solid #000000;">
        <tr>
          <td style="padding:20px 24px;border-bottom:2px solid #000000;">
            <a href="https://intech.studio"><img src="https://intech.studio/email/logo-full.png" alt="Intech Studio" width="200" style="display:block;width:200px;height:auto;border:0;"></a>
          </td>
        </tr>
        <tr>
          <td class="content" style="padding:28px 24px 14px;font-size:15px;line-height:1.5;color:#000000;">
            <#nested>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 20px;border-top:1px solid #d9d9d9;font-size:12px;line-height:1.5;color:#666666;">
            Need help? Reply to this email or write to <a href="mailto:support@intech.studio" style="color:#666666;">support@intech.studio</a>.
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          <td style="padding:20px 24px 0;font-size:12px;line-height:1.5;color:#666666;">
            <img src="https://intech.studio/email/logo-mark.png" alt="" width="36" style="display:block;width:36px;height:auto;border:0;margin:0 0 10px;">
            Intech Studio Kft. &middot; 1053 Budapest, Veres Pálné utca 33. III/1 &middot; <a href="https://intech.studio" style="color:#666666;">intech.studio</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
</#macro>
