export const manager = 'Mandiri Manajemen Investasi, PT';

// The pages of mandiri-investasi.co.id answer 403 to everything but a browser (Cloudflare), so there is no list to read.
// The prospectuses stand at "/ftp/prospectus/id/<code>.pdf", which anyone may fetch. The codes are kept here: the
// code of a share class ends in "-A", and the file without a class ("MITRA.pdf") is an old one that is not updated.
// To add a fund, take its code from the "/ftp/prospectus/id/" link on its page at
// https://www.mandiri-investasi.co.id/id/produk/reksa-dana/ in a browser, and add it with the fund's name.
const FUNDS = [
  ['MIA', 'Mandiri Investa Aktif'],
  ['ETFLQ45', 'Mandiri ETF LQ45'],
  ['ETF-SRIKEHATI', 'Mandiri ETF SRI-KEHATI'],
  ['FTSEESG-A', 'Mandiri Indeks FTSE Indonesia ESG Kelas A'],
  ['FTSEESG-B', 'Mandiri Indeks FTSE Indonesia ESG Kelas B'],
  ['MIION-A', 'Mandiri Investa Indeks Obligasi Negara Kelas A'],
  ['MIION-B', 'Mandiri Investa Indeks Obligasi Negara Kelas B'],
  ['MIPU2', 'Mandiri Investa Pasar Uang 2'],
  ['MIPU-A', 'Mandiri Investa Pasar Uang Kelas A'],
  ['MIPU-B', 'Mandiri Investa Pasar Uang Kelas B'],
  ['MMUSD', 'Mandiri Money Market USD'],
  ['IDAMAN-A', 'Investa Dana Dollar Mandiri Kelas A'],
  ['IDAMAN-D', 'Investa Dana Dollar Mandiri Kelas D'],
  ['MIDO2-A', 'Mandiri Investa Dana Obligasi Seri II Kelas A'],
  ['MIDS-A', 'Mandiri Investa Dana Syariah Kelas A'],
  ['MIDS-D', 'Mandiri Investa Dana Syariah Kelas D'],
  ['MIDU-A', 'Mandiri Investa Dana Utama Kelas A'],
  ['MIDU-B', 'Mandiri Investa Dana Utama Kelas B'],
  ['MIDU-D', 'Mandiri Investa Dana Utama Kelas D'],
  ['MASED-A', 'Mandiri Asia Sharia Equity Dollar Kelas A'],
  ['MASED-B', 'Mandiri Asia Sharia Equity Dollar Kelas B'],
  ['MGSED-A', 'Mandiri Global Sharia Equity Dollar Kelas A'],
  ['MGSED-B', 'Mandiri Global Sharia Equity Dollar Kelas B'],
  ['MITRA-A', 'Mandiri Investa Atraktif Kelas A'],
  ['MITRA-B', 'Mandiri Investa Atraktif Kelas B'],
  ['MICB-A', 'Mandiri Investa Cerdas Bangsa Kelas A'],
  ['MICB-B', 'Mandiri Investa Cerdas Bangsa Kelas B'],
  ['MIED', 'Mandiri Investa Ekuitas Dinamis'],
  ['MIEA5P', 'Mandiri Investa Equity ASEAN 5 Plus'],
  ['MIEDF', 'Mandiri Investa Equity Dynamo Factor'],
  ['MIEM', 'Mandiri Investa Equity Movement'],
  ['MITRAS', 'Mandiri Investa Atraktif Syariah'],
  ['MIES', 'Mandiri Investa Ekuitas Syariah'],
  ['MISB', 'Mandiri Investa Syariah Berimbang'],
  ['MPUS-A', 'Mandiri Pasar Uang Syariah Kelas A'],
  ['MPUS-C', 'Mandiri Pasar Uang Syariah Kelas C'],
];

export const listDocuments = async () => FUNDS.map(([code, name]) => ({ name, url: `https://www.mandiri-investasi.co.id/ftp/prospectus/id/${code}.pdf` }));
