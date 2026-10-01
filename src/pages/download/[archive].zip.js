import { listArchives, zipArchive } from '../../lib/archives.js';

export function getStaticPaths() {
  return listArchives().map((archive) => ({ params: { archive: archive.name }, props: { archive } }));
}

export function GET({ props }) {
  return new Response(zipArchive(props.archive), {
    headers: { 'Content-Type': 'application/zip' },
  });
}
