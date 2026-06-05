function readThreeDigits(num, hasHigher) {
    const ones = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    const tens = ['', 'mười', 'hai mươi', 'ba mươi', 'bốn mươi', 'năm mươi', 'sáu mươi', 'bảy mươi', 'tám mươi', 'chín mươi'];
    const hundred = Math.floor(num / 100);
    const ten = Math.floor((num % 100) / 10);
    const one = num % 10;
    const result = [];
    if (hundred > 0) result.push(ones[hundred] + ' trăm');
    if (ten > 1) {
        result.push(tens[ten]);
        if (one === 1) result.push('mốt');
        else if (one === 5) result.push('lăm');
        else if (one > 0) result.push(ones[one]);
    } else if (ten === 1) {
        result.push('mười');
        if (one === 5) result.push('lăm');
        else if (one > 0) result.push(ones[one]);
    } else if (one > 0) {
        if (hundred > 0 || hasHigher) result.push('lẻ');
        if (one === 5 && (hundred > 0 || hasHigher)) result.push('năm');
        else result.push(ones[one]);
    }
    return result.join(' ');
}

function numberToVietnameseWords(value) {
    let amount = Math.floor(Math.abs(Number(value) || 0));
    if (!Number.isFinite(amount) || amount <= 0) return 'Không đồng';
    const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
    const parts = [];
    const groups = [];
    while (amount > 0) {
        groups.push(amount % 1000);
        amount = Math.floor(amount / 1000);
    }
    for (let i = groups.length - 1; i >= 0; i--) {
        if (groups[i] === 0) continue;
        const text = readThreeDigits(groups[i], i < groups.length - 1);
        parts.push(text + (units[i] ? ' ' + units[i] : ''));
    }
    const sentence = parts.join(' ').replace(/\s+/g, ' ').trim();
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ' đồng';
}

module.exports = { numberToVietnameseWords };
