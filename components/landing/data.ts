import {
  Sparkles,
  MessageCircle,
  ScanLine,
  PieChart,
  User,
  Store,
  Users,
  MapPin,
  TrendingUp,
  ShieldCheck,
  Clock,
} from "lucide-react";
import type {
  Capability,
  ChartPoint,
  ChatExample,
  FaqEntry,
  ModeItem,
  Plan,
  TrustItem,
} from "./types";

export const EXAMPLES: ChatExample[] = [
  { user: "ขายกาแฟ 3 แก้ว 150 บาท", kind: "รายรับ", cat: "เครื่องดื่ม", amount: "+฿150", sign: "pos" },
  { user: "ซื้อนมสด 2 ลัง 640 บาท", kind: "รายจ่าย", cat: "วัตถุดิบ", amount: "-฿640", sign: "neg" },
  { user: "ค่าเช่าที่บูธวันนี้ 300", kind: "รายจ่าย", cat: "ค่าเช่า", amount: "-฿300", sign: "neg" },
];

export const MODES: ModeItem[] = [
  {
    key: "personal",
    label: "ส่วนตัว",
    icon: User,
    title: "จัดการเงินส่วนตัวให้เป็นระบบ",
    desc: "บันทึกรายรับรายจ่ายทุกวัน เห็นว่าเงินหายไปกับอะไรบ้าง ก่อนสิ้นเดือนจะได้ไม่ต้องเดา",
  },
  {
    key: "shop",
    label: "ร้านค้า",
    icon: Store,
    title: "รู้กำไรร้านแบบวันต่อวัน",
    desc: "แยกต้นทุนกับกำไรอัตโนมัติ สแกนใบเสร็จซื้อของแล้วปล่อยให้ Rizq จัดหมวดหมู่ให้",
  },
  {
    key: "booth",
    label: "บูธ",
    icon: MapPin,
    title: "ปิดบัญชีแต่ละงานได้ในคลิกเดียว",
    desc: "แยกบัญชีทุกงานออกจากกัน ขายจบงานไหน สรุปกำไรงานนั้นได้ทันที ไม่ปนกับงานอื่น",
  },
  {
    key: "org",
    label: "องค์กร",
    icon: Users,
    title: "งบกลุ่มที่ทุกคนตรวจสอบได้",
    desc: "เหมาะกับชมรม กลุ่มลงทุน หรือวิสาหกิจชุมชน ที่ต้องรายงานเงินให้สมาชิกเห็นตรงกัน",
  },
];

export const CAPS: Capability[] = [
  { icon: MessageCircle, title: "คุยแล้วจดให้", desc: "พิมพ์เป็นประโยคธรรมดา Rizq เข้าใจและบันทึกให้ทันที" },
  { icon: ScanLine, title: "ถ่ายใบเสร็จ แยกรายการเอง", desc: "ส่งรูปสลิปหรือใบเสร็จ ระบบแยกทุกบรรทัดให้อัตโนมัติ" },
  { icon: PieChart, title: "ถามกำไรได้ทุกเมื่อ", desc: "พิมพ์ถาม Rizq สรุปตัวเลขให้ทันที ไม่ต้องเปิดตารางเอง" },
  { icon: Sparkles, title: "แยกบัญชีทุกโหมด", desc: "ส่วนตัว ร้านค้า บูธ องค์กร ข้อมูลแต่ละที่ไม่ปนกัน" },
];

export const TRUST: TrustItem[] = [
  { icon: ShieldCheck, title: "ไม่ต้องผูกบัตร", desc: "เริ่มใช้ฟรีได้ทันที ไม่มีเงื่อนไขซ่อน" },
  { icon: Clock, title: "ตั้งค่าใน 30 วินาที", desc: "ไม่ต้องเรียนรู้ระบบใหม่ พิมพ์แล้วใช้ได้เลย" },
  { icon: TrendingUp, title: "ยกเลิกได้ทุกเมื่อ", desc: "ไม่มีข้อผูกมัดรายปี จ่ายเท่าที่ใช้จริง" },
];

export const CHART_DATA: ChartPoint[] = [
  { d: "จ", v: 38 },
  { d: "อ", v: 52 },
  { d: "พ", v: 44 },
  { d: "พฤ", v: 68 },
  { d: "ศ", v: 58 },
  { d: "ส", v: 86 },
  { d: "อา", v: 74 },
];

export const PLANS: Plan[] = [
  {
    key: "free",
    name: "ฟรี",
    price: "฿0",
    period: "ตลอดไป",
    tag: null,
    highlight: false,
    items: ["บันทึกไม่จำกัด", "Rizq AI จำกัดต่อเดือน", "ดูย้อนหลัง 7 วัน"],
  },
  {
    key: "personal_plus",
    name: "Personal Plus",
    price: "฿49",
    period: "/เดือน",
    tag: null,
    highlight: false,
    items: ["Rizq AI ใช้เต็มที่", "แยกใบเสร็จอัตโนมัติ", "ดูย้อนหลังไม่จำกัด"],
  },
  {
    key: "event_pass",
    name: "Event Pass",
    price: "฿49",
    period: "/7 วัน",
    tag: null,
    highlight: false,
    items: ["ใช้ได้เต็มที่ตลอดงาน", "แยกบัญชีต่องาน", "เหมาะกับบูธระยะสั้น"],
  },
  {
    key: "business",
    name: "Business",
    price: "฿99",
    period: "/เดือน",
    tag: "แนะนำ",
    highlight: true,
    items: ["ไม่จำกัดร้าน", "รายงานเชิงลึก", "รองรับทีมงาน"],
  },
];

export const FAQS: FaqEntry[] = [
  { q: "ต้องผูกบัตรก่อนใช้งานไหม", a: "ไม่ต้องครับ แพ็กเกจฟรีใช้ได้ทันทีโดยไม่ต้องกรอกข้อมูลบัตร อัพเกรดเมื่อพร้อมจ่ายจริงเท่านั้น" },
  { q: "ข้อมูลการเงินปลอดภัยแค่ไหน", a: "ข้อมูลทุกบัญชีเข้ารหัสและแยกเก็บตามผู้ใช้ ไม่มีใครเห็นข้อมูลของร้านคุณนอกจากคุณ" },
  { q: "ถ้าใช้ไม่เป็น จะเรียนรู้ยากไหม", a: "ไม่ยากเลย เพราะไม่มีฟอร์มให้กรอก แค่พิมพ์เป็นประโยคที่คุณพูดอยู่แล้วทุกวัน" },
  { q: "ยกเลิกแพ็กเกจแล้วข้อมูลหายไหม", a: "ไม่หายครับ ข้อมูลเก่ายังอยู่ครบ แค่กลับไปใช้สิทธิ์แพ็กเกจฟรีตามเดิม" },
];
