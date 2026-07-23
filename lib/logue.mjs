// Thin logging helpers over chalk + ora.
import chalk from 'chalk';
import ora from 'ora';

export { chalk };

export function spinner(text) {
  return ora({ text, color: 'yellow' });
}

export function added(path) {
  console.log(`  ${chalk.green('+')} ${path}`);
}

export function removed(path) {
  console.log(`  ${chalk.red('-')} ${path}`);
}

export function info(msg) {
  console.log(chalk.cyan(msg));
}

export function warn(msg) {
  console.log(chalk.yellow(msg));
}

export function error(msg) {
  console.error(chalk.red(msg));
}

export function heading(msg) {
  console.log(`\n${chalk.bold(msg)}`);
}
