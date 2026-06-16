const gulp = require('gulp');

function copyIcons() {
	return gulp.src([
		'nodes/**/*.{png,svg}',
		'credentials/**/*.{png,svg}'
	], { base: '.' })
	.pipe(gulp.dest('dist'));
}

exports['build:icons'] = copyIcons;
