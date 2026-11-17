import sharp from 'sharp';
import { defaultChecklist } from '../../../shared/defaults';
import type { Category, Revision, Sop } from '../../../shared/types';
import { getMeta, setMeta } from '../db';
import { findMedia, storeBuffer } from '../services/media';

const SCREEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="760" viewBox="0 0 1280 760">
<rect width="1280" height="760" fill="#f3f4f6"/>
<rect width="1280" height="56" fill="#1e293b"/>
<circle cx="28" cy="28" r="10" fill="#38bdf8"/><text x="50" y="36" font-family="Arial" font-size="20" fill="#fff" font-weight="bold">WMS</text>
<text x="120" y="35" font-family="Arial" font-size="16" fill="#cbd5e1">Inbound  ›  Receiving  ›  Trailer Check-In</text>
<rect x="0" y="56" width="220" height="704" fill="#fff"/>
${['Dashboard', 'Receiving', 'Put-away', 'Inventory', 'Shipping', 'Yard / Dock', 'Reports'].map((t, i) => `<rect x="12" y="${80 + i * 46}" width="196" height="36" rx="6" fill="${i === 1 ? '#e0f2fe' : '#fff'}"/><text x="28" y="${104 + i * 46}" font-family="Arial" font-size="15" fill="${i === 1 ? '#0369a1' : '#475569'}">${t}</text>`).join('')}
<text x="252" y="104" font-family="Arial" font-size="24" fill="#0f172a" font-weight="bold">Trailer Check-In</text>
${[['Trailer #', 'TRL-48213'], ['Carrier', 'Midwest Freight'], ['PO / ASN', '4500098812'], ['Dock door', 'D-07']].map(([k, v], i) => `<text x="252" y="${150 + i * 64}" font-family="Arial" font-size="14" fill="#64748b">${k}</text><rect x="252" y="${158 + i * 64}" width="380" height="36" rx="5" fill="#fff" stroke="#cbd5e1"/><text x="264" y="${182 + i * 64}" font-family="Arial" font-size="16" fill="#0f172a">${v}</text>`).join('')}
<rect x="672" y="140" width="580" height="300" rx="8" fill="#fff" stroke="#e2e8f0"/>
<text x="692" y="172" font-family="Arial" font-size="16" fill="#0f172a" font-weight="bold">Expected lines</text>
${[0, 1, 2, 3, 4].map((i) => `<rect x="692" y="${190 + i * 46}" width="540" height="38" fill="${i % 2 ? '#fff' : '#f8fafc'}"/><text x="704" y="${214 + i * 46}" font-family="Arial" font-size="14" fill="#334155">SKU-10${42 + i}7   Pallet   Qty ${(i + 2) * 12}</text>`).join('')}
<rect x="252" y="430" width="200" height="48" rx="8" fill="#16a34a"/><text x="282" y="461" font-family="Arial" font-size="17" fill="#fff" font-weight="bold">Confirm Arrival</text>
<rect x="244" y="422" width="216" height="64" rx="12" fill="none" stroke="#ef4444" stroke-width="5"/>
<rect x="472" y="430" width="140" height="48" rx="8" fill="#fff" stroke="#cbd5e1"/><text x="510" y="461" font-family="Arial" font-size="17" fill="#334155">Cancel</text>
</svg>`;

const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94a3b8"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient>
<pattern id="stripe" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="20" height="40" fill="#facc15"/><rect x="20" width="20" height="40" fill="#111827"/></pattern></defs>
<rect width="1200" height="800" fill="url(#sky)"/>
<rect x="0" y="560" width="1200" height="240" fill="#6b7280"/>
<rect x="160" y="80" width="880" height="480" fill="#475569"/>
${Array.from({ length: 11 }, (_, i) => `<rect x="190" y="${110 + i * 40}" width="820" height="32" fill="#cbd5e1"/>`).join('')}
<rect x="140" y="560" width="920" height="40" fill="url(#stripe)"/>
<rect x="110" y="480" width="50" height="120" fill="#111827"/><rect x="1040" y="480" width="50" height="120" fill="#111827"/>
<rect x="240" y="620" width="720" height="130" fill="#e5e7eb" stroke="#9ca3af" stroke-width="4"/>
<circle cx="330" cy="760" r="40" fill="#111827"/><circle cx="870" cy="760" r="40" fill="#111827"/>
<polygon points="400,760 470,690 470,760" fill="#f97316"/>
<rect x="1000" y="250" width="110" height="80" rx="10" fill="#111827"/><circle cx="1030" cy="290" r="16" fill="#ef4444"/><circle cx="1080" cy="290" r="16" fill="#22c55e"/>
</svg>`;

async function sampleMediaIds(): Promise<{ screen: string; photo: string }> {
  const raw = getMeta('sample_media');
  if (raw) {
    const ids = JSON.parse(raw) as { screen: string; photo: string };
    if (findMedia(ids.screen) && findMedia(ids.photo)) return ids;
  }
  const screen = await storeBuffer(await sharp(Buffer.from(SCREEN_SVG)).png().toBuffer(), 'sample-wms-screen.png', 'image/png', null);
  const photo = await storeBuffer(await sharp(Buffer.from(PHOTO_SVG)).jpeg({ quality: 88 }).toBuffer(), 'sample-dock-photo.jpg', 'image/jpeg', null);
  const ids = { screen: screen.id, photo: photo.id };
  setMeta('sample_media', JSON.stringify(ids));
  return ids;
}

export async function sampleSop(): Promise<{ sop: Sop; category: Category; revisions: Revision[] }> {
  const ids = await sampleMediaIds();
  const now = new Date().toISOString();
  const sop: Sop = {
    id: 'sample',
    number: 'WH-TRL-001',
    title: 'Trailer Check-In & Unloading',
    categoryId: 'sample',
    templateId: null,
    status: 'draft',
    version: '2.1',
    owner: 'Jordan Ellis, Inbound Supervisor',
    approver: 'Sam Patel, Operations Manager',
    effectiveDate: now.slice(0, 10),
    reviewDate: null,
    tags: ['dock', 'receiving'],
    source: 'manual',
    coverMediaId: ids.photo,
    stepCount: 5,
    checklist: false,
    publishedVersion: '2.0',
    publishedRevisionId: null,
    createdBy: null,
    updatedBy: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    ownerUserId: null,
    content: {
      checklist: { ...defaultChecklist(), fields: [{ id: 'trailer', label: 'Trailer #', required: true }, { id: 'door', label: 'Dock door', required: true }] },
      purpose:
        'Make sure every inbound trailer is checked in, secured and unloaded safely, and that the receipt in the WMS matches what was physically delivered.',
      scope: 'Applies to all inbound trailers at **dock doors D-01 to D-12**, on every shift.',
      responsibilities:
        '- **Dock associate:** secures the trailer, unloads and stages freight.\n- **Receiving clerk:** checks the trailer in and confirms the receipt in the WMS.\n- **Shift supervisor:** resolves discrepancies and damaged freight.',
      safety: ['High-visibility vest', 'Steel-toe safety boots', 'Cut-resistant gloves', 'Wheel chocks on both sides', 'Dock lock engaged (green light)'],
      tools: ['RF scanner', 'WMS: Trailer Check-In screen', 'Electric pallet jack', 'Dock plate / leveler', 'Trailer seal cutter'],
      steps: [
        { id: 's0', kind: 'section', title: 'Before unloading', body: '', callout: { type: 'none', text: '' }, media: [] },
        {
          id: 's1',
          kind: 'step',
          title: 'Check the trailer in',
          body: 'Open **Receiving › Trailer Check-In**. Enter the **Trailer #**, **PO / ASN** and **Dock door**, then select **Confirm Arrival**.',
          callout: { type: 'tip', text: 'Scan the PO barcode on the bill of lading instead of typing it.' },
          media: [{ mediaId: ids.screen, caption: 'Trailer Check-In screen' }],
        },
        {
          id: 's2',
          kind: 'step',
          title: 'Secure the trailer',
          body: '1. Chock both rear wheels.\n2. Engage the dock lock and confirm the **green** light inside.\n3. Lower the dock leveler onto the trailer bed.',
          callout: { type: 'danger', text: 'Never enter a trailer until the dock lock light is green. A trailer that moves can cause serious injury.' },
          media: [{ mediaId: ids.photo, caption: 'Door D-07 with dock lock and chock in place' }],
        },
        {
          id: 's3',
          kind: 'step',
          title: 'Verify and cut the seal',
          body: 'Compare the seal number with the bill of lading. Record it on the check-in screen, then cut the seal.',
          callout: { type: 'warning', text: 'If the seal number does not match, stop and call the shift supervisor.' },
          media: [],
        },
        { id: 's4', kind: 'section', title: 'Unloading', body: '', callout: { type: 'none', text: '' }, media: [] },
        {
          id: 's5',
          kind: 'step',
          title: 'Unload and stage pallets',
          body: 'Unload pallets in order, front to back. Stage them in the lane for the door and scan each pallet label.',
          callout: { type: 'caution', text: 'Check the trailer floor for damage before driving the pallet jack in.' },
          media: [],
        },
        {
          id: 's6',
          kind: 'step',
          title: 'Close out the receipt',
          body: 'When the trailer is empty, release the dock lock, remove the chocks and mark the door **Empty** in the WMS.',
          callout: { type: 'note', text: 'Report damaged freight with photos before the driver leaves.' },
          media: [],
        },
      ],
      notes: 'Related: WH-RCV-004 Damaged Freight Handling · WH-SAF-002 Dock Safety Program',
      attachments: [],
    },
  };
  const category: Category = {
    id: 'sample',
    name: 'Trailer & Dock',
    code: 'TRL',
    color: '#b45309',
    description: '',
    templateId: null,
    sortOrder: 0,
  };
  const revisions: Revision[] = [
    { id: 'r2', sopId: 'sample', version: '2.0', summary: 'Added dock lock verification step', createdByName: 'Sam Patel', createdAt: now },
    { id: 'r1', sopId: 'sample', version: '1.0', summary: 'Initial release', createdByName: 'Sam Patel', createdAt: '2025-03-10T12:00:00Z' },
  ];
  return { sop, category, revisions };
}
