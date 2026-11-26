#!/usr/bin/env node
import { runHook, handleSessionStart } from '../src/core/hooks.js';
runHook(handleSessionStart);
