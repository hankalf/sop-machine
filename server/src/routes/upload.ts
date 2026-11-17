import multer from 'multer';
import { config } from '../config';

export const upload = multer({
  dest: config.tmpDir,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 25 },
});
