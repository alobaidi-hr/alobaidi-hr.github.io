# L-O HR System — شركة الليث العبيدي

نظام الأوصاف الوظيفية ومؤشرات الأداء وتقييم الأداء.
إعداد مدير الموارد البشرية **أوس فراس الشلال** · Prepared by HR Manager Aws Firas Al-Shalal

الرابط: **https://l-o-hr-system.netlify.app**

- `public/` واجهة النظام
- `netlify/functions/api.mjs` الخادم (Netlify Functions)، والبيانات المتغيرة في Netlify Blobs
- `data/seed.public.json` البيانات العامة (الأقسام، المعايير، مصفوفة الصلاحيات)
- `data/seed.enc.json` بيانات الموظفين والأوصاف **مشفّرة** (AES-256-GCM) — تُفتح مرة واحدة بمفتاح البيانات لدى مدير الموارد البشرية
