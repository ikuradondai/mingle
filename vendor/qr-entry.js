import QRCode from 'qrcode';
export const toDataURL = (value, options) => QRCode.toDataURL(value, options);
