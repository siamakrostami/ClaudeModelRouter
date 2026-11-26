#!/usr/bin/env node
import { runHook, handleAgentPre } from '../src/core/hooks.js';
runHook(handleAgentPre);
