/**
 * 结构化工具错误出口：给模型可执行的下一步指引，阻断报错循环。
 *
 * 借鉴 dsh-ops 的错误契约（lib/ptc/contract.js）：
 * 失败不是「一串含糊的字符串」，而是带 code/retryable/nextAction 的结构化信号，
 * 让模型读到错误就知道下一步该干嘛，而不是瞎猜重试。
 *
 * 字段语义：
 * - code        稳定错误码（模型可识别、可引用）
 * - phase       preflight（执行前校验失败）/ effect（已产生副作用后失败）/ settle（收尾失败）
 * - retryable   true=改输入后可重试；false=该场景重试无意义，必须换路径或先做前置动作
 * - effectState none（无副作用）/ partial（可能部分生效）/ complete（已生效）
 * - nextAction  给模型的一句话下一步指引（核心）
 * - message     人类可读的完整信息
 */
export function toolError({
  code,
  phase = "preflight",
  retryable = true,
  effectState = "none",
  nextAction,
  message,
}) {
  const err = new Error(message ?? nextAction ?? code);
  err.code = code;
  err.phase = phase;
  err.retryable = retryable;
  err.effectState = effectState;
  err.nextAction = nextAction;
  return err;
}
